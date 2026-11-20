import {useId, useRef, useSyncExternalStore} from "react"
import Button from "@/components/ui/Button"
import Dialog from "@/components/ui/Dialog"
import {currentConfirm, settleConfirm, subscribeConfirm, type ConfirmRequest} from "@/lib/confirmDialog"
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
    const cancelRef = useRef<HTMLButtonElement>(null)
    const settle = (confirmed: boolean) => settleConfirm(req.id, confirmed)

    return (
        // Esc cancels; the scrim deliberately does nothing, since a confirmation needs an explicit answer.
        // Focus lands on the safe action.
        <Dialog
            role="alertdialog"
            layer="alert"
            labelledBy={titleId}
            describedBy={body ? bodyId : undefined}
            onDismiss={() => settle(false)}
            initialFocus={cancelRef}
            className="max-w-sm flex flex-col gap-2 p-6"
        >
            <h2 id={titleId} className={`theme-h1-color ${typeTitle}`}>{title}</h2>
            {body && <p id={bodyId} className="text-sm theme-text">{body}</p>}
            <div className="flex items-center justify-end gap-2 pt-4">
                <Button ref={cancelRef} variant="text" onClick={() => settle(false)}>Cancel</Button>
                <Button variant={danger ? "dangerOutlined" : "filled"} onClick={() => settle(true)}>{confirmLabel}</Button>
            </div>
        </Dialog>
    )
}
