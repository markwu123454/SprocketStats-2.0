import type {ReactNode} from "react"
import {AlertCircle} from "lucide-react"

interface NoticeProps {
    children: ReactNode
    className?: string
}

/** Danger notice (design-system/empty-error-states.md). The icon keeps the meaning off colour alone. The tint sits on the opaque card colour so it stays legible over season artwork. */
export default function Notice({children, className = ""}: NoticeProps) {
    return (
        <div
            role="alert"
            className={`flex items-start gap-2 rounded-lg border theme-border-danger theme-danger px-3 py-2 text-sm ${className}`.trim()}
            style={{background: "color-mix(in oklch, var(--theme-danger) 10%, var(--theme-bg))"}}
        >
            <AlertCircle size={16} className="shrink-0 mt-0.5" aria-hidden="true"/>
            <div className="min-w-0">{children}</div>
        </div>
    )
}
