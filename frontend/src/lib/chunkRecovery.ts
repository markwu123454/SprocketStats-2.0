/**
 * Recovering when a page's code won't load.
 *
 * Every deploy renames the JS chunks. A page (or a service worker) still on the
 * previous build asks for chunks the server no longer has, and Vercel used to
 * answer those with index.html, which the browser refuses to run as a module:
 * "Failed to fetch dynamically imported module". A bad copy kept by the
 * service worker fails the same way until it is replaced.
 *
 * Step 1: reload, first letting a waiting service worker take over, which picks
 * up the current build. Step 2, only if the page fails again right after that
 * reload: drop the service worker and its caches and reload from the network.
 * Step 2 is skipped while the site can't be reached, so a device that is
 * offline keeps the copy it runs on. Each step runs at most once per
 * RECOVERY_WINDOW_MS, so a real outage can't loop.
 */

const STORAGE_KEY = "sprocket-chunk-recovery"
export const RECOVERY_WINDOW_MS = 60_000

const CHUNK_ERROR_PATTERNS = [
    /Failed to fetch dynamically imported module/i, // Chromium
    /error loading dynamically imported module/i,   // Firefox
    /Importing a module script failed/i,            // Safari
    /Unable to preload CSS/i,                       // Vite's CSS preload
]

/** Whether `error` means the browser couldn't load a code chunk (rather than the page crashing). */
export function isChunkLoadError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : typeof error === "string" ? error : ""
    return CHUNK_ERROR_PATTERNS.some(pattern => pattern.test(message))
}

export interface RecoveryState {
    step: 1 | 2
    at: number
}

export type RecoveryStep = "reload" | "reset" | "give-up"

/** What to do about a chunk error, given the last attempt (if any) and the time now. */
export function nextRecoveryStep(last: RecoveryState | null, now: number): RecoveryStep {
    if (!last || now - last.at > RECOVERY_WINDOW_MS) return "reload"
    return last.step === 1 ? "reset" : "give-up"
}

export interface RecoveryDeps {
    now: () => number
    load: () => RecoveryState | null
    save: (state: RecoveryState | null) => void
    /** Hand over to a service worker that's waiting with a newer build, if there is one. */
    activateWaitingWorker: () => Promise<void>
    /** Whether the site answers right now, so a reload from the network will work. */
    siteReachable: () => Promise<boolean>
    /** Unregister the service worker and delete every cache it keeps. */
    resetServiceWorker: () => Promise<void>
    reload: () => void
}

// One recovery per page load: two pages failing together (or two boundaries
// catching the same failure) mustn't count as the reload not having helped.
let running: Promise<boolean> | null = null

/**
 * Starts the next recovery step for a chunk error. Resolves true when the page
 * is about to reload, false when it gave up (the caller shows the error).
 */
export function recoverFromChunkError(deps: RecoveryDeps = browserDeps): Promise<boolean> {
    running ??= runRecovery(deps)
    return running
}

/** Test hook: forget the recovery started by this page load. */
export function resetRecoveryForTests() {
    running = null
}

async function runRecovery(deps: RecoveryDeps): Promise<boolean> {
    const now = deps.now()
    const step = nextRecoveryStep(deps.load(), now)
    if (step === "give-up") return false

    if (step === "reload") {
        deps.save({ step: 1, at: now })
        await deps.activateWaitingWorker().catch(() => {})
        deps.reload()
        return true
    }

    // The reload didn't help: this device's copy of the app is bad. Only start
    // over from the network when the network is actually there.
    if (!(await deps.siteReachable().catch(() => false))) return false
    deps.save({ step: 2, at: now })
    await deps.resetServiceWorker().catch(() => {})
    deps.reload()
    return true
}

/** Forget earlier attempts, so a manual retry gets the full recovery again. */
export function clearChunkRecovery(deps: Pick<RecoveryDeps, "save"> = browserDeps) {
    deps.save(null)
}

/** Whether recovery has a step left for an error that happens now. */
export function canRecoverFromChunkError(deps: Pick<RecoveryDeps, "now" | "load"> = browserDeps): boolean {
    return nextRecoveryStep(deps.load(), deps.now()) !== "give-up"
}

// ── Browser implementations ─────────────────────────────────────────────────

const WAITING_WORKER_TIMEOUT_MS = 3000

export const browserDeps: RecoveryDeps = {
    now: () => Date.now(),
    load() {
        try {
            const raw = sessionStorage.getItem(STORAGE_KEY)
            const parsed = raw ? JSON.parse(raw) as RecoveryState : null
            return parsed && (parsed.step === 1 || parsed.step === 2) && typeof parsed.at === "number" ? parsed : null
        } catch {
            return null
        }
    },
    save(state) {
        try {
            if (state) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
            else sessionStorage.removeItem(STORAGE_KEY)
        } catch {
            // Storage blocked: recovery still reloads once per error.
        }
    },
    async activateWaitingWorker() {
        const registration = await navigator.serviceWorker?.getRegistration()
        const waiting = registration?.waiting
        if (!waiting) return
        // sw.js activates on SKIP_WAITING, then takes control of this page.
        await new Promise<void>(resolve => {
            const timer = setTimeout(resolve, WAITING_WORKER_TIMEOUT_MS)
            navigator.serviceWorker.addEventListener("controllerchange", () => {
                clearTimeout(timer)
                resolve()
            }, { once: true })
            waiting.postMessage({ type: "SKIP_WAITING" })
        })
    },
    async siteReachable() {
        if (!navigator.onLine) return false
        // The query string keeps the service worker's precache from answering
        // (it serves index.html for "/" even offline), so this hits the network.
        const res = await fetch(`/?reachable=${Date.now()}`, { cache: "no-store" })
        return res.ok
    },
    async resetServiceWorker() {
        const registrations = await navigator.serviceWorker?.getRegistrations() ?? []
        await Promise.all(registrations.map(r => r.unregister()))
        if (typeof caches !== "undefined") {
            const names = await caches.keys()
            await Promise.all(names.map(name => caches.delete(name)))
        }
    },
    reload: () => window.location.reload(),
}
