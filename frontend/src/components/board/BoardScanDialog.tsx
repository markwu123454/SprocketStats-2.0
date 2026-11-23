import { type RefObject, useCallback, useEffect, useId, useRef, useState } from "react"
import { X } from "lucide-react"
import BoardCamera from "@/components/board/BoardCamera"
import Button from "@/components/ui/Button"
import Dialog from "@/components/ui/Dialog"
import { actWithCode, boardErrorMessage, isBoardGone, isRetryable, type Acting } from "@/lib/boardApi"
import { type Facing, useCodeCamera } from "@/lib/useCodeCamera"
import { focusRing, typeTitle } from "@/lib/uiClasses"

// Nobody has held a code up for this long: close, and the camera goes off.
const GIVE_UP_MS = 30_000

/**
 * "Sign in with code" on the task board. The board's camera runs only while
 * this is open: it closes, and the camera stops, as soon as a member's code
 * signs them in, on Cancel, or after GIVE_UP_MS with no code in view.
 */
export default function BoardScanDialog({ clock, facing, onFlip, onActing, onGone, onClose }: {
    /** The server clock offset from BoardScreen, so the first frame can already be judged. */
    clock: RefObject<number | null>
    facing: Facing
    onFlip: () => void
    onActing: (acting: Acting) => void
    /** The board was deauthorized: back to setup. */
    onGone: () => void
    onClose: () => void
}) {
    const titleId = useId()
    const closeRef = useRef<HTMLButtonElement>(null)
    const [problem, setProblem] = useState<string | null>(null)
    // The board re-renders every second while someone's using it, so the
    // give-up timer reads onClose through a ref instead of restarting each time.
    const onCloseRef = useRef(onClose)
    useEffect(() => { onCloseRef.current = onClose }, [onClose])

    const onCode = useCallback(async (code: string, seenAt: number) => {
        const offset = clock.current
        if (offset === null) {
            setProblem("Can't reach SprocketStats right now. Try again in a moment.")
            return false
        }
        try {
            onActing(await actWithCode({ code, scanned_at: (seenAt + offset) / 1000, scan_id: crypto.randomUUID() }))
            return true
        } catch (err) {
            if (isBoardGone(err)) {
                onGone()
                return true
            }
            setProblem(boardErrorMessage(err))
            return !isRetryable(err)
        }
    }, [clock, onActing, onGone])
    const camera = useCodeCamera({ facing, onCode })

    // Any code in view (or a new problem) starts the wait over.
    useEffect(() => {
        const id = window.setTimeout(() => onCloseRef.current(), GIVE_UP_MS)
        return () => window.clearTimeout(id)
    }, [camera.state, problem])

    return (
        <Dialog labelledBy={titleId} onDismiss={onClose} initialFocus={closeRef} scrim="dark" className="max-w-2xl flex flex-col">
            <div className="flex items-start justify-between gap-3 pl-6 pr-3 pt-5 pb-3">
                <h2 id={titleId} className={`${typeTitle} theme-h1-color pt-1.5`}>Sign in with your code</h2>
                <button
                    ref={closeRef}
                    type="button"
                    onClick={onClose}
                    aria-label="Close"
                    className={`size-11 shrink-0 flex items-center justify-center rounded-lg theme-subtext-color hover:opacity-80 ${focusRing}`}
                >
                    <X className="size-6" aria-hidden="true"/>
                </button>
            </div>
            <div className="px-6 pb-6 flex flex-col gap-4">
                <p className="text-sm theme-text">
                    Open SprocketStats on your phone, tap the code button on the dashboard, and hold your code up to the camera.
                </p>
                <BoardCamera camera={camera} facing={facing} onFlip={onFlip} className="w-full aspect-video"/>
                <div className="flex items-center justify-between gap-3">
                    <p aria-live="polite" className="text-sm">
                        {problem
                            ? <span className="theme-danger">{problem}</span>
                            : camera.error
                                ? <span className="theme-danger">The camera isn't working. Use "Enter your email" instead.</span>
                                : <span className="theme-subtext-color">{camera.state === "sending" ? "Checking your code…" : "Looking for your code…"}</span>}
                    </p>
                    <Button variant="text" onClick={onClose}>Cancel</Button>
                </div>
            </div>
        </Dialog>
    )
}
