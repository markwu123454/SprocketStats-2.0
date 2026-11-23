import { useCallback, useEffect, useLayoutEffect, useState } from "react"
import { WifiOff } from "lucide-react"
import BoardScreen from "@/components/board/BoardScreen"
import BoardSetup from "@/components/board/BoardSetup"
import { useAppReady } from "@/contexts/appReadyContext"
import { fetchBoard, isBoardGone, type BoardInfo } from "@/lib/boardApi"
import type { Facing } from "@/lib/useCodeCamera"
import { typeTitle } from "@/lib/uiClasses"

const FACING_KEY = "sprocket-board-facing"
const RETRY_MS = 10_000

type Phase =
    | { kind: "loading" }
    | { kind: "setup" }
    | { kind: "ready"; info: BoardInfo }
    | { kind: "offline" }

function loadFacing(): Facing {
    try {
        return localStorage.getItem(FACING_KEY) === "environment" ? "environment" : "user"
    } catch {
        return "user"
    }
}

function saveFacing(facing: Facing) {
    try {
        localStorage.setItem(FACING_KEY, facing)
    } catch {
        // Storage blocked: the choice lasts until the page reloads.
    }
}

/**
 * The TV board's type grows with the screen: the root font size follows the
 * viewport, so every rem-based size on the page (Tailwind's type and spacing)
 * reads from across the shop on a 1080p TV and still fits a tablet.
 * Put back on leaving.
 */
function useScreenSizedType() {
    useLayoutEffect(() => {
        const root = document.documentElement
        const previous = root.style.fontSize
        // Sized for a 42–55" TV a few metres away: 10px on a 1280×800 tablet, 15px at 1920×1080.
        root.style.fontSize = "clamp(10px, min(0.8vw, 1.42vh), 20px)"
        return () => { root.style.fontSize = previous }
    }, [])
}

/** Keeps the tablet's screen on (and so the TV's picture) while the board is up. */
function useWakeLock() {
    useEffect(() => {
        let lock: WakeLockSentinel | null = null
        let stopped = false
        const request = () => {
            if (document.visibilityState !== "visible") return
            navigator.wakeLock?.request("screen").then(l => {
                if (stopped) void l.release()
                else lock = l
            }).catch(() => {})
        }
        request()
        // The browser drops the lock whenever the page is hidden.
        document.addEventListener("visibilitychange", request)
        return () => {
            stopped = true
            document.removeEventListener("visibilitychange", request)
            void lock?.release()
        }
    }, [])
}

/**
 * `/board`: the task board for a TV in the shop, opened on a tablet in kiosk
 * mode. Nobody signs in here: a lead sets the board up by showing their code
 * to its camera (BoardSetup), and members act as themselves on it by showing
 * theirs or typing their email (BoardScreen). See backend/endpoints/board.py.
 */
export default function BoardPage() {
    const markReady = useAppReady()
    const [phase, setPhase] = useState<Phase>({ kind: "loading" })
    const [facing, setFacing] = useState<Facing>(loadFacing)
    useScreenSizedType()
    useWakeLock()

    useEffect(() => {
        const previous = document.title
        document.title = "Task board | SprocketStats"
        return () => { document.title = previous }
    }, [])

    const load = useCallback(async () => {
        try {
            setPhase({ kind: "ready", info: await fetchBoard() })
        } catch (err) {
            setPhase(isBoardGone(err) ? { kind: "setup" } : { kind: "offline" })
        }
    }, [])
    useEffect(() => { void load() }, [load])

    // No connection when the board started: keep trying.
    useEffect(() => {
        if (phase.kind !== "offline") return
        const id = window.setInterval(() => void load(), RETRY_MS)
        return () => window.clearInterval(id)
    }, [phase.kind, load])

    useEffect(() => {
        if (phase.kind !== "loading") markReady()
    }, [phase.kind, markReady])

    const flip = useCallback(() => {
        setFacing(prev => {
            const next: Facing = prev === "user" ? "environment" : "user"
            saveFacing(next)
            return next
        })
    }, [])
    const onReady = useCallback((info: BoardInfo) => setPhase({ kind: "ready", info }), [])
    const onGone = useCallback(() => setPhase({ kind: "setup" }), [])

    if (phase.kind === "loading") return null
    if (phase.kind === "setup") return <BoardSetup facing={facing} onFlip={flip} onReady={onReady}/>
    if (phase.kind === "ready") return <BoardScreen key={phase.info.kiosk_id} info={phase.info} facing={facing} onFlip={flip} onGone={onGone}/>
    return (
        <div className="flex-1 min-h-0 flex items-center justify-center p-4 theme-bg-page bg-cover bg-center">
            <div role="status" className="max-w-lg rounded-2xl border theme-border theme-bg p-6 flex items-start gap-3">
                <WifiOff className="size-6 shrink-0 theme-danger" aria-hidden="true"/>
                <div className="flex flex-col gap-1">
                    <p className={`${typeTitle} theme-h1-color`}>Can't reach SprocketStats</p>
                    <p className="text-sm theme-text">Check the tablet's Wi-Fi. The board tries again every few seconds.</p>
                </div>
            </div>
        </div>
    )
}
