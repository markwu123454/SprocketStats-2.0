import {useEffect, useId, useMemo, useRef, useState, type KeyboardEvent} from "react"
import {createPortal} from "react-dom"
import {WifiOff, X} from "lucide-react"
import {useOnboardedUser} from "@/contexts/authContext"
import {dataMatrix, dataMatrixPath} from "@/lib/dataMatrix"
import {isTopOverlay, lockScroll, pushOverlay, trapTab} from "@/lib/modalStack"
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
    | {kind: "offline"}
    | {kind: "unavailable"}

/**
 * The member's rotating code as a pass card over a dimmed page. Works offline
 * once the key has been downloaded; the kiosk shows the result, not this.
 */
export default function MyCodeDialog({onClose}: {onClose: () => void}) {
    const user = useOnboardedUser()
    const titleId = useId()
    const panelRef = useRef<HTMLDivElement>(null)
    const closeRef = useRef<HTMLButtonElement>(null)
    const [token] = useState(() => Symbol("my-code"))
    const [opener] = useState<Element | null>(() => document.activeElement)
    const [state, setState] = useState<KeyState>({kind: "loading"})
    const [code, setCode] = useState<string | null>(null)
    const [fraction, setFraction] = useState(0)

    // Overlay bookkeeping, same as ConfirmDialog: Esc/Tab for the top overlay,
    // scroll lock, and focus back to the opener on close.
    useEffect(() => {
        const unregister = pushOverlay(token)
        const unlock = lockScroll()
        closeRef.current?.focus({preventScroll: true})
        return () => {
            unregister()
            unlock()
            if (opener instanceof HTMLElement && document.contains(opener)) opener.focus({preventScroll: true})
        }
    }, [token, opener])

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

    // Stored key first (works offline); refresh it when online so the clock
    // offset stays current and a bumped code version is picked up.
    useEffect(() => {
        let cancelled = false
        void (async () => {
            const stored = await loadMemberCodeKey(user.id)
            if (cancelled) return
            if (stored) setState({kind: "ready", rec: stored})
            if (!navigator.onLine) {
                if (!stored) setState({kind: "offline"})
                return
            }
            try {
                const fresh = await syncMemberCodeKey()
                if (!cancelled) setState({kind: "ready", rec: fresh})
            } catch (err) {
                if (cancelled || stored) return
                setState({kind: err instanceof MemberCodeUnavailable ? "unavailable" : "offline"})
            }
        })()
        return () => {
            cancelled = true
        }
    }, [user.id])

    // Recompute the code whenever the step changes.
    useEffect(() => {
        if (state.kind !== "ready") return
        const {rec} = state
        let cancelled = false
        let shownStep: number | null = null
        const tick = () => {
            const {step, fraction} = stepAt(Date.now(), rec)
            setFraction(fraction)
            if (step === shownStep) return
            shownStep = step
            void codeAt(rec.key, rec.codeNumber, step).then(c => {
                if (!cancelled) setCode(c)
            })
        }
        tick()
        const timer = window.setInterval(tick, 200)
        return () => {
            cancelled = true
            window.clearInterval(timer)
        }
    }, [state])

    const symbol = useMemo(() => (code ? dataMatrix(code) : null), [code])

    useEffect(() => {
        const onDocKey = (e: globalThis.KeyboardEvent) => {
            const panel = panelRef.current
            if (!panel || !isTopOverlay(token) || panel.contains(e.target as Node)) return
            if (e.key === "Escape") {
                e.preventDefault()
                onClose()
            } else trapTab(e, panel)
        }
        document.addEventListener("keydown", onDocKey)
        return () => document.removeEventListener("keydown", onDocKey)
    }, [token, onClose])

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        e.stopPropagation()
        const panel = panelRef.current
        if (!panel || !isTopOverlay(token)) return
        if (e.key === "Escape") {
            e.preventDefault()
            onClose()
        } else trapTab(e, panel)
    }

    const side = symbol ? symbol.length + MARGIN * 2 : 1

    return createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onKeyDown={onKeyDown}>
            <div className="absolute inset-0 bg-black/70 sds-scrim-enter" aria-hidden="true" onClick={onClose}/>
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                className="sds-dialog-enter relative w-full max-w-[360px] overflow-hidden rounded-2xl border theme-border theme-bg shadow-2xl outline-none"
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
                            <div className="h-full" style={{width: `${Math.round(fraction * 100)}%`, background: "var(--theme-text-contrast)"}}/>
                        </div>
                    </>
                ) : (
                    <div className="aspect-square w-full border-t border-dashed theme-border flex flex-col items-center justify-center gap-4 p-10 text-center">
                        <WifiOff size={48} className="theme-subtext-color" aria-hidden="true"/>
                        <p className="max-w-60 text-base font-semibold theme-text">
                            {state.kind === "unavailable"
                                ? "This account can't use a member code"
                                : "Connect to the internet to set up your code"}
                        </p>
                    </div>
                )}
            </div>
        </div>,
        document.body,
    )
}
