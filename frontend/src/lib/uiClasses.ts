/**
 * Shared Tailwind class strings for the Sprocket Design System. Kept apart from the
 * components so pages that need a *class* (an <a> that looks like a button, a native
 * <input>) can use it without importing a component. Spec: design-system/*.md.
 *
 * Tailwind scans this file, so every class must stay a complete literal string.
 */

/** Focus is a 2px accent ring on every control, keyboard focus only. */
export const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-text-contrast)]"

export type ButtonVariant = "filled" | "outlined" | "text" | "danger" | "dangerOutlined" | "icon" | "fab"
export type ButtonSize = "default" | "footer" | "hero"

const buttonBase =
    "inline-flex items-center justify-center gap-2 text-sm font-semibold whitespace-nowrap transition-opacity " +
    "hover:opacity-90 active:opacity-70 disabled:opacity-40 disabled:cursor-not-allowed " + focusRing

const buttonVariant: Record<ButtonVariant, string> = {
    filled: "theme-accent-fill",
    outlined: "theme-bg border theme-outline theme-text-contrast",
    text: "bg-transparent theme-subtext-color",
    danger: "bg-transparent theme-danger",
    dangerOutlined: "bg-transparent border theme-border-danger theme-danger",
    icon: "bg-transparent theme-subtext-color",
    // Mobile only, bottom-right, above the 64px tab bar plus the safe area.
    fab: "fixed right-4 z-30 md:hidden shadow-lg theme-accent-fill bottom-[calc(5rem+env(safe-area-inset-bottom))]",
}

const buttonSize: Record<ButtonSize, string> = {
    default: "h-11 md:h-10 px-4 rounded-lg",
    footer: "h-12 md:h-10 px-4 rounded-lg",
    hero: "h-[52px] px-4 rounded-xl",
}

export function buttonClass({variant = "filled", size = "default", className = ""}: {
    variant?: ButtonVariant
    size?: ButtonSize
    className?: string
} = {}): string {
    let shape: string
    if (variant === "icon") shape = "w-11 h-11 rounded-lg"
    else if (variant === "fab") shape = "w-14 h-14 rounded-full"
    else shape = buttonSize[size]
    return `${buttonBase} ${buttonVariant[variant]} ${shape} ${className}`.trim()
}

/** Text input / textarea / select-like field (forms.md). Add `w-full` where the parent doesn't stretch it. */
export const inputClass =
    "rounded-lg border theme-outline theme-bg theme-text px-3 py-2.5 text-base md:text-sm min-h-11 " +
    "placeholder:text-[var(--theme-subtext-color)] disabled:opacity-40 disabled:cursor-not-allowed " + focusRing

export const fieldLabelClass = "text-sm font-semibold theme-h1-color"
export const helperClass = "text-xs theme-subtext-color"
export const fieldErrorClass = "text-xs theme-danger"

// Type scale (typography.md). Size and weight only; add the colour role at the call site.
export const typeH1 = "text-2xl font-bold"
export const typeH2 = "text-xs font-semibold uppercase tracking-widest"
export const typeTitle = "text-lg font-semibold"
export const typeBadge = "font-mono text-[11px] uppercase tracking-[0.14em]"

/** Card / panel (DESIGN_SYSTEM 3.6): flat, bordered, no shadow. */
export const cardClass = "rounded-xl border theme-border p-5 flex flex-col gap-3"

/** Menu option row: 40px on web, 48px on mobile (navigation.md). */
export const menuRowClass =
    "flex items-center justify-between gap-3 w-full px-3 min-h-12 md:min-h-10 text-sm text-left rounded-lg " + focusRing
