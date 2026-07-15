import { createContext, useContext } from "react"

// Context object + hook + types live here (no components) so themeProvider.tsx
// can own the component surface without React Fast Refresh complaining about a
// file that mixes components and non-components.

export type Theme = "theme-2025" | "theme-2026" | "theme-2027"

export type ThemeContextType = {
    theme: Theme
    setTheme: (t: Theme) => void
    isDark: boolean
}

export const ThemeContext = createContext<ThemeContextType | null>(null)

export function useTheme() {
    const ctx = useContext(ThemeContext)
    if (!ctx) throw new Error("useTheme must be used inside ThemeProvider")
    return ctx
}
