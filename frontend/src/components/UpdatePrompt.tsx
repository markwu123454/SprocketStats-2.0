import { useState } from "react"
import { RefreshCw } from "lucide-react"
import { useRegisterSW } from "virtual:pwa-register/react"

/**
 * Registers the service worker and shows a small, non-blocking banner when a
 * new frontend build has been downloaded and is waiting (sw.js never skips
 * waiting on its own). "Reload" tells the waiting worker to activate and then
 * reloads onto the new UI; "Later" hides the banner until the next launch, at
 * which point the new build is picked up anyway.
 *
 * The browser only looks for a new sw.js on full navigations, which an SPA or a
 * backgrounded mobile PWA rarely does, so we also check every time the app
 * comes back to the foreground.
 */
export default function UpdatePrompt() {
    const [reloading, setReloading] = useState(false)
    const {
        needRefresh: [needRefresh, setNeedRefresh],
        updateServiceWorker,
    } = useRegisterSW({
        onRegisteredSW(_swUrl, registration) {
            if (!registration) return
            document.addEventListener("visibilitychange", () => {
                if (document.visibilityState === "visible" && navigator.onLine) {
                    registration.update().catch(() => {})
                }
            })
        },
    })

    if (!needRefresh) return null

    return (
        <div
            className="fixed inset-x-0 bottom-0 z-[110] flex justify-center p-4 pointer-events-none"
            style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
        >
            <div
                role="status"
                className="pointer-events-auto w-full max-w-md rounded-2xl border p-4 flex items-center gap-3 backdrop-blur-sm theme-bg theme-border shadow-lg"
            >
                <RefreshCw size={18} className="shrink-0 theme-text-contrast" />
                <p className="flex-1 text-sm theme-text-contrast">A new version of SprocketStats is available.</p>
                <button
                    onClick={() => setNeedRefresh(false)}
                    className="rounded-lg px-3 py-2 text-sm font-medium theme-subtext-color transition-opacity hover:opacity-70"
                >
                    Later
                </button>
                <button
                    onClick={() => {
                        setReloading(true)
                        void updateServiceWorker(true)
                    }}
                    disabled={reloading}
                    className="rounded-lg border px-3 py-2 text-sm font-semibold transition-opacity theme-text-contrast theme-border"
                    style={{
                        background: "color-mix(in oklch, var(--theme-button-bg) 80%, transparent)",
                        opacity: reloading ? 0.35 : 1,
                    }}
                >
                    {reloading ? "Reloading…" : "Reload"}
                </button>
            </div>
        </div>
    )
}
