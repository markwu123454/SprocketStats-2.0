import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { getSetting, getSettingSync, setSetting, type Settings } from "@/db/settingsDb.ts"

type ThemeContextType = {
    theme: Settings["theme"]
    setTheme: (t: Settings["theme"]) => void
}

const ThemeContext = createContext<ThemeContextType | null>(null)

export default function ThemeProvider({ children }: { children: ReactNode }) {
    const [theme, setThemeState] = useState<Settings["theme"]>(() =>
        getSettingSync("theme")
    )

    // Async load for Dexie consistency
    useEffect(() => {
        const load = async () => {
            const t = await getSetting("theme")
            if (t) setThemeState(t)
        }
        void load()
    }, [])

    // Apply theme + persist
    useEffect(() => {
        const root = document.documentElement
        root.classList.remove("theme-2026", "theme-2025", "theme-dark", "theme-light")
        if (theme) root.classList.add(`theme-${theme.toLowerCase()}`)
        if (theme) void setSetting({ theme })
    }, [theme])

    const setTheme = (t: Settings["theme"]) => {
        setThemeState(t)
    }

    return (
        <ThemeContext.Provider value={{ theme, setTheme }}>
            {children}
        </ThemeContext.Provider>
    )
}

export function useTheme() {
    const ctx = useContext(ThemeContext)
    if (!ctx) throw new Error("useTheme must be used inside ThemeProvider")
    return ctx
}
