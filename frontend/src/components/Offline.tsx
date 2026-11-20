import {WifiOff} from "lucide-react"
import EmptyState from "@/components/ui/EmptyState"

/**
 * "Offline" in the top bar: the one app-wide sign that pages are showing info
 * saved on this phone. Nothing else mentions being offline unless data or an
 * action isn't available (design-system/empty-error-states.md).
 */
export function OfflineLabel({className = ""}: {className?: string}) {
    return (
        <p role="status" className={`m-0 flex items-center gap-1.5 text-[13px] font-semibold theme-subtext-color ${className}`.trim()}>
            <WifiOff size={14} aria-hidden="true"/>
            Offline
        </p>
    )
}

/**
 * In place of a page or section whose data isn't saved on the phone. `what`
 * starts the sentence ("The Control Panel"). On a card, like every message:
 * nothing sits bare on the season artwork (DESIGN_SYSTEM.md principle 6).
 */
export function OfflineUnavailable({what}: {what: string}) {
    return (
        <div className="w-full max-w-xl mx-auto px-4 py-6">
            <div className="rounded-xl border min-h-48 flex flex-col justify-center backdrop-blur-sm theme-bg theme-border">
                <EmptyState variant="screen" icon={<WifiOff size={21}/>} title="Not available offline">
                    {what} needs a connection. It loads again once you're back online.
                </EmptyState>
            </div>
        </div>
    )
}
