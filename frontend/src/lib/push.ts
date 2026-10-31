/**
 * The ONLY module allowed to touch the notification / push platform APIs
 * (`Notification`, `navigator.serviceWorker`, `PushManager`). Every page and
 * component must go through the guarded helpers exported here — never call those
 * globals directly.
 *
 * Why: those APIs return null / throw when the PWA isn't installed, permission
 * isn't granted, or the browser doesn't support push. Funnelling all access
 * through this one guarded surface is what stops "notification returned None"
 * from crashing a page. An ESLint rule (see eslint.config.js) enforces this
 * boundary so a new page physically can't reintroduce that crash, and push.test.ts
 * pins the guard behaviour so a refactor can't quietly remove it.
 */

const API = import.meta.env.VITE_BACKEND_URL

// Set when the user turns push off for this device in Settings, cleared when
// they turn it back on. Permission stays "granted" after an unsubscribe, so
// without this the load-time re-sync would quietly resubscribe them.
const OPT_OUT_KEY = "push-opted-out"

// `serviceWorker.ready` never settles when no worker is registered (e.g. the
// dev server, where the PWA plugin's SW is disabled) — cap the wait so nothing
// awaiting it (onboarding, Settings) can hang forever.
const SW_READY_TIMEOUT_MS = 10_000

/** Decode a base64url (no padding) VAPID key into the raw bytes `applicationServerKey` expects. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
    const rawData = atob(base64)
    return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)))
}

function hasOptedOut(): boolean {
    try {
        return localStorage.getItem(OPT_OUT_KEY) === "true"
    } catch {
        return false
    }
}

function setOptedOut(value: boolean): void {
    try {
        if (value) localStorage.setItem(OPT_OUT_KEY, "true")
        else localStorage.removeItem(OPT_OUT_KEY)
    } catch {
        // Storage blocked (private mode etc.) — worst case the re-sync
        // resubscribes this device on a later load.
    }
}

async function readyRegistration(): Promise<ServiceWorkerRegistration> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("The app's service worker isn't running")), SW_READY_TIMEOUT_MS)
    })
    try {
        return await Promise.race([navigator.serviceWorker.ready, timeout])
    } finally {
        clearTimeout(timer)
    }
}

async function fetchApplicationServerKey(): Promise<Uint8Array> {
    const keyRes = await fetch(`${API}/push/public-key`, { credentials: "include" })
    if (!keyRes.ok) throw new Error("Couldn't reach the server")
    const { public_key: publicKey } = (await keyRes.json()) as { public_key: string | null }
    if (!publicKey) throw new Error("Push notifications aren't configured on the server yet")
    return urlBase64ToUint8Array(publicKey)
}

async function saveSubscription(subscription: PushSubscription): Promise<void> {
    const json = subscription.toJSON()
    const res = await fetch(`${API}/push/subscribe`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
    })
    if (!res.ok) throw new Error("Couldn't save your subscription")
}

export function isPushSupported(): boolean {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window
}

export type PushState = "unsupported" | "denied" | "subscribed" | "unsubscribed"

/**
 * Current push state for this browser, without prompting for anything or
 * talking to the backend. Note "subscribed" only means the browser holds a
 * subscription — use `syncPushSubscription` when the backend must agree.
 */
export async function getPushState(): Promise<PushState> {
    if (!isPushSupported()) return "unsupported"
    if (Notification.permission === "denied") return "denied"

    let registration: ServiceWorkerRegistration
    try {
        registration = await readyRegistration()
    } catch {
        return "unsupported"
    }
    const subscription = await registration.pushManager.getSubscription()
    return subscription ? "subscribed" : "unsubscribed"
}

/**
 * Make sure the backend knows about this device's subscription, without ever
 * prompting. Run on app load (and when Settings reads the state):
 *
 * - Permission granted + a local subscription → re-POST it. `/push/subscribe`
 *   is an idempotent upsert, so this heals a server row that was pruned (or
 *   saved under another account on a shared device) while the browser kept
 *   its subscription.
 * - Permission granted + no subscription (expired, or cleared by the browser)
 *   → subscribe again, unless the user turned push off here themselves.
 * - Anything else → nothing to do.
 *
 * Never throws; resolves to the resulting state.
 */
export async function syncPushSubscription(): Promise<PushState> {
    if (!isPushSupported()) return "unsupported"
    if (Notification.permission === "denied") return "denied"
    if (Notification.permission !== "granted") return "unsubscribed"

    let subscription: PushSubscription | null = null
    try {
        const registration = await readyRegistration()
        subscription = await registration.pushManager.getSubscription()
        if (!subscription) {
            if (hasOptedOut()) return "unsubscribed"
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: await fetchApplicationServerKey(),
            })
        }
        await saveSubscription(subscription)
        return "subscribed"
    } catch {
        // Offline / server hiccup: report what the browser has and let the
        // next load retry.
        return subscription ? "subscribed" : "unsubscribed"
    }
}

/**
 * Request notification permission (must be called from a user gesture, e.g. a
 * button click) and register this browser with both the push service and the
 * backend. Throws with a user-facing message on any failure.
 */
export async function subscribeToPush(): Promise<void> {
    if (!isPushSupported()) {
        throw new Error("Push notifications aren't supported in this browser")
    }

    // Must stay the first await: browsers only show the prompt while the
    // click's user activation is still fresh.
    const permission = await Notification.requestPermission()
    if (permission !== "granted") {
        throw new Error("Notification permission was not granted")
    }

    const registration = await readyRegistration()
    const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: await fetchApplicationServerKey(),
        }))

    await saveSubscription(subscription)
    setOptedOut(false)
}

/** Unsubscribe this browser from push, both locally and on the backend. */
export async function unsubscribeFromPush(): Promise<void> {
    if (!isPushSupported()) return

    setOptedOut(true)
    const registration = await readyRegistration()
    const subscription = await registration.pushManager.getSubscription()
    if (!subscription) return

    const endpoint = subscription.endpoint
    await subscription.unsubscribe()

    await fetch(`${API}/push/unsubscribe`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint }),
    })
}

/** Automated push categories (mirrors `PUSH_CATEGORIES` in backend/db/push.py). */
export type PushCategory = "task_assigned" | "meeting_reminder" | "event_reminder"
export type PushPreferences = Record<PushCategory, boolean>

/** The signed-in user's per-category choices (account-wide, not per device). */
export async function getPushPreferences(): Promise<PushPreferences> {
    const res = await fetch(`${API}/push/preferences`, { credentials: "include" })
    if (!res.ok) throw new Error("Couldn't load notification preferences")
    return ((await res.json()) as { preferences: PushPreferences }).preferences
}

/** Update some categories; resolves to the full saved set. */
export async function setPushPreferences(changes: Partial<PushPreferences>): Promise<PushPreferences> {
    const res = await fetch(`${API}/push/preferences`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences: changes }),
    })
    if (!res.ok) throw new Error("Couldn't save notification preferences")
    return ((await res.json()) as { preferences: PushPreferences }).preferences
}

/**
 * Subscribe to "the user tapped a notification while the app was open" — the
 * service worker focuses this tab and posts the notification's in-app path,
 * so the app can route there without a full reload. Returns an unsubscribe.
 */
export function onNotificationNavigate(handler: (path: string) => void): () => void {
    if (!("serviceWorker" in navigator)) return () => {}
    const listener = (event: MessageEvent) => {
        const data = event.data as { type?: string; url?: unknown } | null
        if (data?.type === "NOTIFICATION_NAVIGATE" && typeof data.url === "string") handler(data.url)
    }
    navigator.serviceWorker.addEventListener("message", listener)
    return () => navigator.serviceWorker.removeEventListener("message", listener)
}
