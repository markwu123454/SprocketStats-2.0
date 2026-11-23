import { useCallback, useState } from "react"
import BoardCamera from "@/components/board/BoardCamera"
import { authorizeBoard, boardErrorMessage, isRetryable, type BoardInfo } from "@/lib/boardApi"
import { type Facing, useCodeCamera } from "@/lib/useCodeCamera"
import { useServerClock } from "@/lib/useServerClock"
import { typeBadge, typeH1 } from "@/lib/uiClasses"

/**
 * The board before it's set up: a lead, captain or mentor holds their member
 * code up to the camera, and the server registers this screen as a board.
 */
export default function BoardSetup({ facing, onFlip, onReady }: {
    facing: Facing
    onFlip: () => void
    onReady: (info: BoardInfo) => void
}) {
    const clock = useServerClock()
    const [problem, setProblem] = useState<string | null>(null)

    const onCode = useCallback(async (code: string, seenAt: number) => {
        const offset = clock.current
        if (offset === null) {
            setProblem("Can't reach SprocketStats. Check the tablet's connection.")
            return false
        }
        try {
            onReady(await authorizeBoard({ code, scanned_at: (seenAt + offset) / 1000, scan_id: crypto.randomUUID() }))
            return true
        } catch (err) {
            setProblem(boardErrorMessage(err))
            return !isRetryable(err)
        }
    }, [clock, onReady])
    const camera = useCodeCamera({ facing, onCode })

    return (
        <div className="flex-1 min-h-0 overflow-y-auto flex items-center justify-center p-4 theme-bg-page bg-cover bg-center">
            <div className="w-full max-w-3xl rounded-2xl border theme-border theme-bg p-6 flex flex-col gap-5">
                <div className="flex flex-col gap-1">
                    <p className={`${typeBadge} theme-subtext-color`}>SprocketStats · Task board</p>
                    <h1 className={`${typeH1} theme-h1-color`}>Set up this board</h1>
                </div>
                <BoardCamera camera={camera} facing={facing} onFlip={onFlip} className="w-full aspect-video"/>
                <p aria-live="polite" className="text-sm">
                    {problem
                        ? <span className="theme-danger">{problem}</span>
                        : !camera.error && <span className="theme-subtext-color">{camera.state === "sending" ? "Checking the code…" : "Waiting for a code…"}</span>}
                </p>
            </div>
        </div>
    )
}
