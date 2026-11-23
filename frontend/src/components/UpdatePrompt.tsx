import { useEffect, useRef, useState } from "react"
import { useLocation } from "react-router-dom"
import { RefreshCw } from "lucide-react"
import { useRegisterSW } from "virtual:pwa-register/react"
import Button from "@/components/ui/Button"
import { isBoardBusy } from "@/lib/boardApi"

// The task board (/board) stays on one page all day with nobody to tap Reload,
// so it checks for a new build on a timer and reloads onto it by itself once
// nobody is using it.
const BOARD_CHECK_MS = 30 * 60_000
const BOARD_IDLE_POLL_MS = 5_000

/**
 * Registers the service worker and shows a small, non-blocking banner when a
 * new frontend build has been downloaded and is waiting (sw.js never skips
 * waiting on its own). "Reload" tells the waiting worker to activate and then
 * reloads onto the new UI; "Later" hides the banner until the next launch, at
 * which point the new build is picked up anyway.
 *
 * The browser only looks for a new sw.js on full navigations, which an SPA or a
 * backgrounded mobile PWA rarely does, so we also check every time the app
 * comes back to the foreground. The task board shows no banner: it updates
 * itself (see BOARD_CHECK_MS).
 */
export default function UpdatePrompt() {
    const [reloading, setReloading] = useState(false)
    const registrationRef = useRef<ServiceWorkerRegistration | null>(null)
    const onBoard = useLocation().pathname === "/board"
    const {
        needRefresh: [needRefresh, setNeedRefresh],
        updateServiceWorker,
    } = useRegisterSW({
        onRegisteredSW(_swUrl, registration) {
            if (!registration) return
            registrationRef.current = registration
            document.addEventListener("visibilitychange", () => {
                if (document.visibilityState === "visible" && navigator.onLine) {
                    registration.update().catch(() => {})
                }
            })
        },
    })

    useEffect(() => {
        if (!onBoard) return
        const id = window.setInterval(() => {
            if (navigator.onLine) registrationRef.current?.update().catch(() => {})
        }, BOARD_CHECK_MS)
        return () => window.clearInterval(id)
    }, [onBoard])

    useEffect(() => {
        if (!onBoard || !needRefresh) return
        const tryReload = () => {
            if (isBoardBusy()) return false
            void updateServiceWorker(true)
            return true
        }
        if (tryReload()) return
        const id = window.setInterval(() => { if (tryReload()) window.clearInterval(id) }, BOARD_IDLE_POLL_MS)
        return () => window.clearInterval(id)
    }, [onBoard, needRefresh, updateServiceWorker])

    if (onBoard) return null

    if (!needRefresh) return null

    return (
        <div
            className="fixed inset-x-0 bottom-0 z-[110] flex justify-center p-4 pointer-events-none"
            style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
        >
            <div
                role="status"
                className="pointer-events-auto w-full max-w-md rounded-2xl border p-4 flex items-center gap-3 theme-bg theme-border shadow-lg"
            >
                <RefreshCw size={18} className="shrink-0 theme-text-contrast" />
                <p className="flex-1 text-sm theme-text-contrast">A new version of SprocketStats is available.</p>
                <Button variant="text" onClick={() => setNeedRefresh(false)}>
                    Later
                </Button>
                <Button
                    onClick={() => {
                        setReloading(true)
                        void updateServiceWorker(true)
                    }}
                    disabled={reloading}
                >
                    {reloading ? "Reloading…" : "Reload"}
                </Button>
            </div>
        </div>
    )
}
