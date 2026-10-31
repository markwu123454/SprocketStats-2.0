import type {ReactNode} from "react"
import {typeTitle} from "@/lib/uiClasses"

interface EmptyStateProps {
    /** Screen variant only. Pass a sized lucide element, e.g. `<Inbox size={21}/>`. */
    icon?: ReactNode
    /** Screen variant only (inline shows `children`). */
    title?: string
    /** The one sentence / line of copy. */
    children?: ReactNode
    /** Screen variant: the one action (a <Button>). Inline: rendered after the line. */
    action?: ReactNode
    variant?: "inline" | "screen"
}

/** Empty state: "inline" is one muted line for a card or list; "screen" is the centred first-use pattern. */
export default function EmptyState({icon, title, children, action, variant = "inline"}: EmptyStateProps) {
    if (variant === "inline") {
        return (
            <div className="py-2">
                <p className="text-sm theme-subtext-color">{children ?? title}</p>
                {action && <div className="mt-2">{action}</div>}
            </div>
        )
    }
    return (
        <div className="flex flex-col items-center justify-center gap-3 px-4 py-12 text-center">
            {icon && <div className="theme-subtext-color" aria-hidden="true">{icon}</div>}
            {title && <h2 className={`theme-h1-color ${typeTitle}`}>{title}</h2>}
            {children && <p className="max-w-sm text-sm theme-subtext-color">{children}</p>}
            {action}
        </div>
    )
}
