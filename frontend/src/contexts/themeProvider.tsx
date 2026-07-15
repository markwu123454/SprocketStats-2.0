import { useState, type ReactNode } from "react"
import { ThemeContext, type Theme } from "./themeContext"

const THEME_KEY = "app-theme"
const DEFAULT_THEME: Theme = "theme-2027"

// Apply theme synchronously on app startup
function initializeTheme(): Theme {
    const stored = localStorage.getItem(THEME_KEY) as Theme | null
    const theme = stored ?? DEFAULT_THEME
    if (!stored) {
        localStorage.setItem(THEME_KEY, theme)
    }
    document.documentElement.classList.add(theme)
    return theme
}

export default function ThemeProvider({ children }: { children: ReactNode }) {
    const [theme, setThemeState] = useState<Theme>(() => initializeTheme())

    const setTheme = (t: Theme) => {
        setThemeState(t)
        localStorage.setItem(THEME_KEY, t)

        const bgMap: Record<Theme, string> = {
            "theme-2025": "#0b234f",
            "theme-2026": "#fef7dc",
            "theme-2027": "#0a2f31",
        }
        const bg = bgMap[t]

        document.documentElement.classList.remove("theme-2025", "theme-2026", "theme-2027")
        document.documentElement.classList.add(t)
        document.body.style.backgroundColor = bg

        const meta = document.querySelector('meta[name="theme-color"]')
        if (meta) meta.setAttribute("content", bg)
    }

    const isDark = theme === "theme-2025" || theme === "theme-2027"

    return (
        <ThemeContext.Provider value={{ theme, setTheme, isDark }}>
            {children}
        </ThemeContext.Provider>
    )
}