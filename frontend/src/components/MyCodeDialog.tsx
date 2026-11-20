import {useEffect, useId, useMemo, useRef, useState} from "react"
import {WifiOff, X} from "lucide-react"
import Dialog from "@/components/ui/Dialog"
import {useAuth, useOnboardedUser} from "@/contexts/authContext"
import {withinOfflineWindow} from "@/lib/offline"
import {dataMatrix, dataMatrixPath} from "@/lib/dataMatrix"
import {
    codeAt,
    loadMemberCodeKey,
    MemberCodeUnavailable,
    stepAt,
    syncMemberCodeKey,
    type MemberCodeKey,
} from "@/lib/memberCode"
import {focusRing} from "@/lib/uiClasses"

const MARGIN = 2 // quiet zone, in modules
// Gray, not white: a phone at full white is far brighter than anything else a
// webcam sees, so it overexposes and the light bleeds into the black modules.
// About half the light of white, still ~11:1 against black.
const CODE_LIGHT = "#bbb"

type KeyState =
    | {kind: "loading"}
    | {kind: "ready", rec: MemberCodeKey}
    | {kind: "offline", expired: boolean}
    | {kind: "unavailable"}

/**
 * The member's rotating code as a pass card over a dimmed page. Works offline
 * once the key has been downloaded; the kiosk shows the result, not this.
 */
export default function MyCodeDialog({onClose}: {onClose: () => void}) {
    const user = useOnboardedUser()
    const {offline, holdSession} = useAuth()
    const titleId = useId()
    const closeRef = useRef<HTMLButtonElement>(null)
    const [state, setState] = useState<KeyState>({kind: "loading"})
    const [code, setCode] = useState<string | null>(null)
    const barRef = useRef<HTMLDivElement>(null)

    // Keep the screen on while the code is up.
    useEffect(() => {
        let lock: WakeLockSentinel | null = null
        let released = false
        navigator.wakeLock?.request("screen").then(l => {
            if (released) void l.release()
            else lock = l
        }).catch(() => {})
        return () => {
            released = true
            void lock?.release()
        }
    }, [])

    // Coming back online while the code is up must not sign the member out
    // mid-scan if their session lapsed: that waits until this closes.
    useEffect(() => holdSession(), [holdSession])

    // Stored key first (works offline); refresh it when online so the clock
    // offset stays current and a bumped code version is picked up. A key the
    // phone hasn't refreshed online in 30 days stops showing, the same limit
    // as signing in offline (lib/offline.ts).
    useEffect(() => {
        let cancelled = false
        void (async () => {
            const stored = await loadMemberCodeKey(user.id)
            const usable = stored && withinOfflineWindow(stored.savedAt) ? stored : null
            if (cancelled) return
            if (usable) setState({kind: "ready", rec: usable})
            if (offline || !navigator.onLine) {
                if (!usable) setState({kind: "offline", expired: stored !== null})
                return
            }
            try {
                const fresh = await syncMemberCodeKey()
                if (!cancelled) setState({kind: "ready", rec: fresh})
            } catch (err) {
                if (cancelled || usable) return
                setState(err instanceof MemberCodeUnavailable ? {kind: "unavailable"} : {kind: "offline", expired: stored !== null})
            }
        })()
        return () => {
            cancelled = true
        }
    }, [user.id, offline])

    // Every frame: move the time bar, and switch the code the moment its step
    // changes. The bar is set straight on the element as a transform, so it
    // doesn't re-render anything and moves at the screen's frame rate. (A
    // React-state timer showed visibly stepped motion, worse on iPhones,
    // which slow timers down.)
    useEffect(() => {
        if (state.kind !== "ready") return
        const {rec} = state
        let cancelled = false
        let shownStep: number | null = null
        let frame = 0
        const tick = () => {
            const {step, fraction} = stepAt(Date.now(), rec)
            if (barRef.current) barRef.current.style.transform = `scaleX(${fraction})`
            if (step !== shownStep) {
                shownStep = step
                void codeAt(rec.key, rec.codeNumber, step).then(c => {
                    if (!cancelled && step === shownStep) setCode(c)
                })
            }
            frame = requestAnimationFrame(tick)
        }
        tick()
        return () => {
            cancelled = true
            cancelAnimationFrame(frame)
        }
    }, [state])

    const symbol = useMemo(() => (code ? dataMatrix(code) : null), [code])

    const side = symbol ? symbol.length + MARGIN * 2 : 1

    return (
        // 4px from the screen edges on a phone, so the code is as large as it can
        // be for the kiosk camera. Capped at 480px wide, and by the screen height
        // less the header and time bar (70px) so it still fits in landscape.
        <Dialog
            labelledBy={titleId}
            onDismiss={onClose}
            initialFocus={closeRef}
            scrim="dark"
            edge="tight"
            className="max-w-[min(480px,calc(100dvh-70px))] overflow-hidden"
        >
            <div className="h-14 pl-4 pr-1.5 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                    <div
                        aria-hidden="true"
                        className="size-7 shrink-0"
                        style={{
                            backgroundColor: "var(--theme-h1-color)",
                            mask: "url(/sprocket_logo_gear.svg) center/contain no-repeat",
                            WebkitMask: "url(/sprocket_logo_gear.svg) center/contain no-repeat",
                        }}
                    />
                    <h2 id={titleId} className="text-base font-bold theme-h1-color">
                        Team Sprocket <span className="font-semibold tracking-wider theme-subtext-color">3473</span>
                    </h2>
                </div>
                <button
                    ref={closeRef}
                    type="button"
                    onClick={onClose}
                    aria-label="Close"
                    className={`size-11 flex items-center justify-center rounded-lg theme-subtext-color hover:opacity-80 ${focusRing}`}
                >
                    <X size={22}/>
                </button>
            </div>

            {state.kind === "ready" || state.kind === "loading" ? (
                <>
                    <div className="aspect-square w-full" style={{background: CODE_LIGHT}}>
                        {symbol && (
                            <svg
                                viewBox={`0 0 ${side} ${side}`}
                                shapeRendering="crispEdges"
                                role="img"
                                aria-label="Your SprocketStats code"
                                className="block size-full"
                            >
                                <path d={dataMatrixPath(symbol, MARGIN)} fill="#000"/>
                            </svg>
                        )}
                    </div>
                    <div className="h-1.5" style={{background: "var(--theme-border)"}}>
                        {/* Driven by the frame loop above; React never changes `transform` after mount. */}
                        <div
                            ref={barRef}
                            className="h-full origin-left will-change-transform"
                            style={{transform: "scaleX(0)", background: "var(--theme-text-contrast)"}}
                        />
                    </div>
                </>
            ) : (
                <div className="aspect-square w-full border-t border-dashed theme-border flex flex-col items-center justify-center gap-4 p-10 text-center">
                    <WifiOff size={48} className="theme-subtext-color" aria-hidden="true"/>
                    <p className="max-w-60 text-base font-semibold theme-text">
                        {state.kind === "unavailable"
                            ? "This account can't use a member code"
                            : state.kind === "offline" && state.expired
                                ? "Connect to the internet to refresh your code"
                                : "Connect to the internet to set up your code"}
                    </p>
                </div>
            )}
        </Dialog>
    )
}
