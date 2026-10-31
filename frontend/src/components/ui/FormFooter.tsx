import type {ReactNode} from "react"

interface FormFooterProps {
    children: ReactNode
    /** Add the bottom safe-area inset (mobile only). Set when this is the lowest bar on screen. */
    safeArea?: boolean
    className?: string
}

/** The one footer for every form (design-system/forms.md). Put `mr-auto` on a Delete button and `ml-auto` on Cancel. */
export default function FormFooter({children, safeArea = false, className = ""}: FormFooterProps) {
    return (
        <div
            className={`sticky bottom-0 z-10 flex items-center gap-2 border-t theme-border theme-bg px-4 md:px-6 py-3 ${className}`.trim()}
            style={safeArea ? {paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))"} : undefined}
        >
            {children}
        </div>
    )
}
