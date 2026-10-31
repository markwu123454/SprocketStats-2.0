import {useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent} from "react"
import {createPortal} from "react-dom"
import Button from "@/components/ui/Button"
import {currentConfirm, settleConfirm, subscribeConfirm, type ConfirmRequest} from "@/lib/confirmDialog"
import {isTopOverlay, lockScroll, pushOverlay, trapTab} from "@/lib/modalStack"
import {typeTitle} from "@/lib/uiClasses"

/** Mount once near the app root. Renders the alert dialog for `confirmDialog(...)` calls. */
export default function ConfirmHost() {
    const req = useSyncExternalStore(subscribeConfirm, currentConfirm, currentConfirm)
    if (!req) return null
    return <ConfirmView key={req.id} req={req}/>
}

function ConfirmView({req}: {req: ConfirmRequest}) {
    const {title, body, confirmLabel, danger} = req.options
    const titleId = useId()
    const bodyId = useId()
    const panelRef = useRef<HTMLDivElement>(null)
    const cancelRef = useRef<HTMLButtonElement>(null)
    const [token] = useState(() => Symbol("confirm"))
    const [opener] = useState<Element | null>(() => document.activeElement)
    const settle = (confirmed: boolean) => settleConfirm(req.id, confirmed)

    useEffect(() => {
        const unregister = pushOverlay(token)
        const unlock = lockScroll()
        // Land on the safe action.
        cancelRef.current?.focus({preventScroll: true})
        return () => {
            unregister()
            unlock()
            if (opener instanceof HTMLElement && opener !== document.body && document.contains(opener)) {
                opener.focus({preventScroll: true})
            }
        }
    }, [token, opener])

    // Keys while focus is outside the dialog.
    useEffect(() => {
        const onDocKey = (e: globalThis.KeyboardEvent) => {
            const panel = panelRef.current
            if (!panel || !isTopOverlay(token) || panel.contains(e.target as Node)) return
            if (e.key === "Escape") { e.preventDefault(); settleConfirm(req.id, false) }
            else trapTab(e, panel)
        }
        document.addEventListener("keydown", onDocKey)
        return () => document.removeEventListener("keydown", onDocKey)
    }, [token, req.id])

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        e.stopPropagation()
        const panel = panelRef.current
        if (!panel || !isTopOverlay(token)) return
        if (e.key === "Escape") {
            e.preventDefault()
            settle(false)
        } else {
            trapTab(e, panel)
        }
    }

    return createPortal(
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center p-4"
            onClick={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
            onKeyDown={onKeyDown}
        >
            {/* Scrim click deliberately does nothing: a confirmation needs an explicit answer. */}
            <div className="absolute inset-0 bg-black/50 sds-scrim-enter" aria-hidden="true"/>
            <div
                ref={panelRef}
                role="alertdialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={body ? bodyId : undefined}
                tabIndex={-1}
                className="sds-dialog-enter relative w-full max-w-sm flex flex-col gap-2 p-6 theme-bg theme-border border rounded-2xl shadow-lg outline-none"
            >
                <h2 id={titleId} className={`theme-h1-color ${typeTitle}`}>{title}</h2>
                {body && <p id={bodyId} className="text-sm theme-text">{body}</p>}
                <div className="flex items-center justify-end gap-2 pt-4">
                    <Button ref={cancelRef} variant="text" onClick={() => settle(false)}>Cancel</Button>
                    <Button variant={danger ? "dangerOutlined" : "filled"} onClick={() => settle(true)}>{confirmLabel}</Button>
                </div>
            </div>
        </div>,
        document.body,
    )
}
