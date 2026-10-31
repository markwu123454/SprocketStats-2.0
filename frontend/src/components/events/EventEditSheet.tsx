import type { ReactNode } from "react"
import Sheet from "@/components/ui/Sheet"

interface EventEditSheetProps {
    title: string
    onClose: () => void
    children: ReactNode
    /** Unsaved edits: dismissing asks "Discard changes?" first (see Sheet). */
    dirty?: boolean
}

/** Sheet for editing or creating an event: a drag sheet on a phone, a centred
 *  dialog from `md` up. The scroller keeps side padding only (no bottom padding,
 *  no safe-area), so the sticky footer inside `EventScheduleEditor` sits flush
 *  at the bottom of the scroll area. */
export default function EventEditSheet({ title, onClose, children, dirty }: EventEditSheetProps) {
    return (
        <Sheet title={title} onClose={onClose} kind="form" dirty={dirty} className="px-4 md:px-6 pt-2">
            {children}
        </Sheet>
    )
}
