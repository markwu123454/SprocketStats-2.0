import { useCallback, useRef } from "react"
import { AppReadyContext } from "./appReadyContext"

export function AppReadyProvider({ children }: { children: React.ReactNode }) {
    const dismissed = useRef(false)

    const markReady = useCallback(() => {
        if (dismissed.current) return
        dismissed.current = true
        const splash = document.getElementById("initial-loader")
        if (splash) {
            splash.classList.add("fade-out")
            splash.addEventListener("transitionend", () => splash.remove(), { once: true })
        }
    }, [])

    return (
        <AppReadyContext.Provider value={markReady}>
            {children}
        </AppReadyContext.Provider>
    )
}
