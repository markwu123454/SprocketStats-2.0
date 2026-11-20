import type {ReactNode} from "react"
import {AlertCircle, X} from "lucide-react"
import Button from "@/components/ui/Button"

interface NoticeProps {
    children: ReactNode
    className?: string
    /** Shows a dismiss button at the end. */
    onDismiss?: () => void
}

/** Danger notice (design-system/empty-error-states.md). The icon keeps the meaning off colour alone. The tint sits on the opaque card colour so it stays legible over season artwork. */
export default function Notice({children, className = "", onDismiss}: NoticeProps) {
    return (
        <div
            role="alert"
            className={`flex items-start gap-2 rounded-lg border theme-border-danger theme-danger px-3 py-2 text-sm ${className}`.trim()}
            style={{background: "color-mix(in oklch, var(--theme-danger) 10%, var(--theme-bg))"}}
        >
            <AlertCircle size={16} className="shrink-0 mt-0.5" aria-hidden="true"/>
            <div className="min-w-0 flex-1">{children}</div>
            {onDismiss && (
                <Button variant="icon" aria-label="Dismiss" className="shrink-0 -my-3 -mr-3" onClick={onDismiss}>
                    <X size={14}/>
                </Button>
            )}
        </div>
    )
}
