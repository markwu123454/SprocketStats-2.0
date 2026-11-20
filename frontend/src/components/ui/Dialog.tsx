import {useRef, type ReactNode, type RefObject} from "react"
import {createPortal} from "react-dom"
import {useOverlay} from "@/lib/useOverlay"

/** Stacking layers from the z table in design-system/modals.md. */
const LAYER_Z = {
    dialog: "z-50",
    alert: "z-[60]",
    notice: "z-[100]",
} as const

interface DialogProps {
    /** Id of the visible heading inside that names the dialog. */
    labelledBy: string
    describedBy?: string
    /** Esc, and a scrim click unless this is an alert dialog. Omit for a dialog nothing dismisses (a required notice). */
    onDismiss?: () => void
    /** "alertdialog" for a confirmation: the scrim does nothing and presses stay inside. */
    role?: "dialog" | "alertdialog"
    /** "alert" sits over sheets; "notice" over everything but snackbars. */
    layer?: keyof typeof LAYER_Z
    /** "dark" for full-attention surfaces (the camera, the member code). */
    scrim?: "default" | "dark"
    /** "tight" leaves 4px to the screen edge, so a member code can fill a phone. */
    edge?: "default" | "tight"
    /** Focused on open; otherwise the panel. */
    initialFocus?: RefObject<HTMLElement | null>
    /** The panel's width, padding and layout. */
    className?: string
    children: ReactNode
}

/**
 * The one centred dialog (modals.md): portal, scrim, enter motion, z layer, and the
 * shared open/close behaviour from `useOverlay` (overlay stack, scroll lock, focus in
 * and back, Tab trap, Esc). Every centred modal in the app renders through this;
 * menus and edit forms on mobile are `Sheet`s instead.
 */
export default function Dialog({
    labelledBy, describedBy, onDismiss, role = "dialog", layer = "dialog", scrim = "default", edge = "default",
    initialFocus, className = "", children,
}: DialogProps) {
    const panelRef = useRef<HTMLDivElement>(null)
    const onKeyDown = useOverlay(panelRef, {onEscape: onDismiss, initialFocus})
    const alert = role === "alertdialog"

    return createPortal(
        <div
            className={`fixed inset-0 ${LAYER_Z[layer]} flex items-center justify-center ${edge === "tight" ? "p-1" : "p-4"}`}
            // Clicks stop here so React parents (a clickable row, a Dropdown) never see them. An alert
            // dialog also keeps mousedown, so an outside-click listener under it (an open menu) stays put.
            onClick={e => e.stopPropagation()}
            onMouseDown={alert ? e => e.stopPropagation() : undefined}
            onKeyDown={onKeyDown}
        >
            <div
                className={`absolute inset-0 sds-scrim-enter ${scrim === "dark" ? "bg-black/70" : "bg-black/50"}`}
                aria-hidden="true"
                onClick={alert ? undefined : onDismiss}
            />
            <div
                ref={panelRef}
                role={role}
                aria-modal="true"
                aria-labelledby={labelledBy}
                aria-describedby={describedBy}
                tabIndex={-1}
                className={`sds-dialog-enter relative w-full theme-bg theme-border border rounded-2xl shadow-lg outline-none ${className}`}
            >
                {children}
            </div>
        </div>,
        document.body,
    )
}
