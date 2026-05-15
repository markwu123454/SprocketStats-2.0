import { createContext, useContext, useState, type ReactNode } from "react"

type Theme = "theme-2025" | "theme-2026" | "theme-2027"

type ThemeContextType = {
    theme: Theme
    setTheme: (t: Theme) => void
}

const ThemeContext = createContext<ThemeContextType | null>(null)

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

        // Update DOM
        document.documentElement.classList.remove("theme-2025", "theme-2026", "theme-2027")
        document.documentElement.classList.add(t)
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