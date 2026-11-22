import {useCallback, useEffect, useId, useRef, useState} from "react"
import {CameraOff, LogIn, LogOut, SwitchCamera, X} from "lucide-react"
import Dialog from "@/components/ui/Dialog"
import {centerOf, codeNumberOf, createCodeReader, memberCodeOf, type Point} from "@/lib/codeReader"
import {focusRing} from "@/lib/uiClasses"

const API = import.meta.env.VITE_BACKEND_URL

const FACING_KEY = "sprocket-scanner-facing"
// A code unseen for this long has left the frame; showing it again is a new scan.
// A found-but-unreadable code (blur, glare) near a known one counts as "seen".
const GONE_MS = 1500
// How close (as a share of the frame's diagonal) an unreadable code must be to
// a known one to be treated as the same phone.
const SAME_PLACE = 0.25
// After a rejected scan, wait this long before trying the same appearance again.
const RETRY_MS = 1500
const BANNER_MS = 3000
const RECENT_LIMIT = 5

type Facing = "environment" | "user"

interface ScanResult {
    id: string
    name: string
    first_name: string
    status: "checked_in" | "checked_out"
    repeat: boolean
    at: number
}

// One continuous appearance of a member's code in front of the camera. It keeps
// one scan_id, so a retry can never toggle the member twice. Several can be
// live at once when more than one phone is held up.
interface Appearance {
    codeNumber: string
    scanId: string
    lastSeen: number
    center: Point
    state: "sending" | "done" | "failed"
    failedAt: number
}

type BoxState = Appearance["state"] | "reading"

/** Outlines of the codes in the latest decoded frame, in that frame's pixels. */
interface Overlay {
    width: number
    height: number
    boxes: {quad: Point[], state: BoxState}[]
}

const BOX_COLOR: Record<BoxState, string> = {
    reading: "rgba(255,255,255,.85)",
    sending: "#facc15",
    done: "#22c55e",
    failed: "#ef4444",
}

type Setup =
    | {kind: "starting"}
    | {kind: "ready", kioskId: string, clockOffsetMs: number}
    | {kind: "error", message: string}

function loadFacing(): Facing {
    try {
        return localStorage.getItem(FACING_KEY) === "user" ? "user" : "environment"
    } catch {
        return "environment"
    }
}

function saveFacing(facing: Facing) {
    try {
        localStorage.setItem(FACING_KEY, facing)
    } catch {
        // Storage unavailable: the choice just isn't remembered.
    }
}

async function detailOf(res: Response): Promise<string> {
    try {
        const body = await res.json() as {detail?: unknown}
        if (typeof body.detail === "string") return body.detail
    } catch {
        // Not JSON.
    }
    return `Scan failed (${res.status})`
}

/**
 * A handheld kiosk: reads members' codes with the front or back camera and
 * checks them in or out. Opening it registers this phone as a kiosk in the
 * operator's name; closing it deauthorizes that kiosk again.
 */
export default function ScannerDialog({onClose}: {onClose: () => void}) {
    const titleId = useId()
    const closeRef = useRef<HTMLButtonElement>(null)
    const videoRef = useRef<HTMLVideoElement>(null)
    const [facing, setFacing] = useState<Facing>(loadFacing)
    const [cameraCount, setCameraCount] = useState(0)
    const [cameraError, setCameraError] = useState<string | null>(null)
    const [setup, setSetup] = useState<Setup>({kind: "starting"})
    const [recent, setRecent] = useState<ScanResult[]>([])
    const [scanError, setScanError] = useState<string | null>(null)
    const [now, setNow] = useState(() => Date.now())
    const [overlay, setOverlay] = useState<Overlay | null>(null)
    const appearancesRef = useRef(new Map<string, Appearance>())

    // Keep the screen on while scanning.
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

    // Register this phone as a kiosk, and learn the server's clock: a scan is
    // judged against the moment it was read, which must match the server's.
    useEffect(() => {
        let cancelled = false
        let kioskId: string | null = null
        void (async () => {
            try {
                const sentAt = Date.now()
                const clockRes = await fetch(`${API}/kiosk/clock`, {cache: "no-store"})
                const receivedAt = Date.now()
                if (!clockRes.ok) throw new Error(await detailOf(clockRes))
                const {server_time} = await clockRes.json() as {server_time: number}
                const clockOffsetMs = server_time * 1000 - (sentAt + receivedAt) / 2

                const res = await fetch(`${API}/kiosk/scanner`, {method: "POST", credentials: "include"})
                if (!res.ok) throw new Error(await detailOf(res))
                kioskId = (await res.json() as {kiosk_id: string}).kiosk_id
                if (cancelled) closeKiosk(kioskId)
                else setSetup({kind: "ready", kioskId, clockOffsetMs})
            } catch (err) {
                if (!cancelled) setSetup({kind: "error", message: err instanceof Error ? err.message : "Couldn't start the scanner"})
            }
        })()
        return () => {
            cancelled = true
            if (kioskId) closeKiosk(kioskId)
        }
    }, [])

    // Camera stream for the chosen side.
    useEffect(() => {
        let cancelled = false
        let stream: MediaStream | null = null
        setCameraError(null)
        if (!navigator.mediaDevices?.getUserMedia) {
            setCameraError("This browser can't use the camera")
            return
        }
        navigator.mediaDevices.getUserMedia({
            video: {facingMode: {ideal: facing}, width: {ideal: 1280}, height: {ideal: 720}},
            audio: false,
        }).then(async s => {
            if (cancelled) {
                s.getTracks().forEach(t => t.stop())
                return
            }
            stream = s
            const video = videoRef.current
            if (video) {
                video.srcObject = s
                await video.play().catch(() => {})
            }
            // Labels and the full device list only appear once permission is granted.
            const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [])
            if (!cancelled) setCameraCount(devices.filter(d => d.kind === "videoinput").length)
        }).catch((err: unknown) => {
            if (cancelled) return
            const name = err instanceof DOMException ? err.name : ""
            setCameraError(name === "NotAllowedError"
                ? "Camera access is blocked. Allow it in your browser settings."
                : name === "NotFoundError" ? "No camera found" : "Couldn't start the camera")
        })
        return () => {
            cancelled = true
            stream?.getTracks().forEach(t => t.stop())
        }
    }, [facing])

    // `seenAt` is when the frame was captured (Date.now() clock): the server
    // judges a rotating code against the moment it was read, not when it arrived.
    const submit = useCallback(async (a: Appearance, code: string, seenAt: number, kioskId: string, clockOffsetMs: number) => {
        a.state = "sending"
        try {
            const res = await fetch(`${API}/kiosk/scanner/${encodeURIComponent(kioskId)}/scan`, {
                method: "POST",
                credentials: "include",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({code, scanned_at: (seenAt + clockOffsetMs) / 1000, scan_id: a.scanId}),
            })
            if (!res.ok) throw new Error(await detailOf(res))
            const body = await res.json() as Omit<ScanResult, "id" | "at">
            a.state = "done"
            setScanError(null)
            setRecent(prev => [{...body, id: a.scanId, at: Date.now()}, ...prev].slice(0, RECENT_LIMIT))
            if (!body.repeat) navigator.vibrate?.(body.status === "checked_in" ? 80 : [40, 60, 40])
        } catch (err) {
            a.state = "failed"
            a.failedAt = performance.now()
            setScanError(err instanceof Error && err.message !== "Failed to fetch" ? err.message : "No connection. Hold the code up again.")
        }
    }, [])

    // Decode loop: frames go to a worker one at a time, and the next is grabbed
    // as soon as the last one answers (paced to new camera frames where the
    // browser supports requestVideoFrameCallback), so it runs as fast as the
    // device decodes without ever queueing stale frames.
    useEffect(() => {
        if (setup.kind !== "ready") return
        const {kioskId, clockOffsetMs} = setup
        const reader = createCodeReader()
        const appearances = appearancesRef.current
        let stopped = false
        let timer = 0
        let frameHandle = 0
        let frameVideo: HTMLVideoElement | null = null

        const handle = (width: number, height: number, codes: {text: string | null, quad: Point[]}[], seenAt: number) => {
            const t = performance.now()
            const reach = SAME_PLACE * Math.hypot(width, height)
            const boxes: Overlay["boxes"] = []

            for (const found of codes) {
                const center = centerOf(found.quad)
                const code = memberCodeOf(found.text)
                if (found.text !== null && !code) continue // some other DataMatrix: ignore it
                if (code) {
                    const number = codeNumberOf(code)
                    let a = appearances.get(number)
                    if (a && t - a.lastSeen < GONE_MS) {
                        a.lastSeen = t
                        a.center = center
                        if (a.state === "failed" && t - a.failedAt > RETRY_MS) void submit(a, code, seenAt, kioskId, clockOffsetMs)
                    } else {
                        a = {codeNumber: number, scanId: crypto.randomUUID(), lastSeen: t, center, state: "sending", failedAt: 0}
                        appearances.set(number, a)
                        void submit(a, code, seenAt, kioskId, clockOffsetMs)
                    }
                    boxes.push({quad: found.quad, state: a.state})
                    continue
                }
                // Found but unreadable: keep the nearest live appearance alive.
                let nearest: Appearance | null = null
                let best = reach
                for (const a of appearances.values()) {
                    const d = Math.hypot(a.center.x - center.x, a.center.y - center.y)
                    if (t - a.lastSeen < GONE_MS && d < best) {
                        best = d
                        nearest = a
                    }
                }
                if (nearest) {
                    nearest.lastSeen = t
                    nearest.center = center
                }
                boxes.push({quad: found.quad, state: nearest?.state ?? "reading"})
            }

            for (const [number, a] of appearances) {
                if (t - a.lastSeen > GONE_MS * 4) appearances.delete(number)
            }
            setOverlay(prev => (boxes.length === 0 && prev === null ? prev : boxes.length ? {width, height, boxes} : null))
        }

        const schedule = () => {
            if (stopped) return
            const video = videoRef.current
            if (video && "requestVideoFrameCallback" in video) {
                frameVideo = video
                frameHandle = video.requestVideoFrameCallback(() => void tick())
            } else {
                timer = window.setTimeout(() => void tick(), 30)
            }
        }

        const tick = async () => {
            const video = videoRef.current
            if (video && video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth > 0) {
                const seenAt = Date.now()
                try {
                    const bitmap = await createImageBitmap(video)
                    if (stopped) {
                        bitmap.close()
                        return
                    }
                    const res = await reader.read(bitmap, seenAt)
                    if (stopped) return
                    if (res.width > 0) handle(res.width, res.height, res.codes, res.capturedAt)
                } catch {
                    // A frame that can't be captured (camera switching) is just skipped.
                }
            }
            schedule()
        }
        schedule()
        return () => {
            stopped = true
            window.clearTimeout(timer)
            if (frameVideo && frameHandle) frameVideo.cancelVideoFrameCallback(frameHandle)
            reader.close()
            setOverlay(null)
        }
    }, [setup, submit])

    // Ticks the banner away once it's stale.
    useEffect(() => {
        if (recent.length === 0) return
        const id = window.setInterval(() => setNow(Date.now()), 500)
        return () => window.clearInterval(id)
    }, [recent.length])

    const flip = () => {
        const next: Facing = facing === "user" ? "environment" : "user"
        saveFacing(next)
        setFacing(next)
    }

    const latest = recent[0]
    const banner = latest && now - latest.at < BANNER_MS ? latest : null
    const problem = setup.kind === "error" ? setup.message : cameraError

    return (
        <Dialog
            labelledBy={titleId}
            onDismiss={onClose}
            initialFocus={closeRef}
            scrim="dark"
            className="max-w-[420px] max-h-full overflow-y-auto"
        >
            <div className="h-14 pl-4 pr-1.5 flex items-center justify-between gap-2">
                <h2 id={titleId} className="text-base font-bold theme-h1-color">Check-in scanner</h2>
                <div className="flex items-center">
                    {cameraCount > 1 && (
                        <button
                            type="button"
                            onClick={flip}
                            aria-label={facing === "user" ? "Use back camera" : "Use front camera"}
                            className={`h-11 px-3 flex items-center gap-1.5 rounded-lg text-sm font-semibold theme-subtext-color hover:opacity-80 ${focusRing}`}
                        >
                            <SwitchCamera size={20} aria-hidden="true"/>
                            {facing === "user" ? "Front" : "Back"}
                        </button>
                    )}
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
            </div>

            <div className="relative aspect-square w-full bg-black overflow-hidden">
                <video
                    ref={videoRef}
                    muted
                    playsInline
                    aria-hidden="true"
                    className="size-full object-cover"
                    // The front camera reads like a mirror; the decoder still gets the raw frame.
                    style={facing === "user" ? {transform: "scaleX(-1)"} : undefined}
                />
                {problem ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-10 text-center bg-black/80">
                        <CameraOff size={48} className="text-white/70" aria-hidden="true"/>
                        <p className="max-w-64 text-base font-semibold text-white">{problem}</p>
                    </div>
                ) : (
                    <div aria-hidden="true" className="absolute inset-[18%] rounded-2xl border-2 border-white/40"/>
                )}
                {/* Outlines found codes: white while reading, yellow sending, green done, red failed.
                    "slice" matches the video's object-cover crop; mirrored with the front camera like the video. */}
                {overlay && !problem && (
                    <svg
                        aria-hidden="true"
                        className="absolute inset-0 size-full pointer-events-none"
                        viewBox={`0 0 ${overlay.width} ${overlay.height}`}
                        preserveAspectRatio="xMidYMid slice"
                        style={facing === "user" ? {transform: "scaleX(-1)"} : undefined}
                    >
                        {overlay.boxes.map((b, i) => (
                            <polygon
                                key={i}
                                points={b.quad.map(p => `${p.x},${p.y}`).join(" ")}
                                fill={b.state === "done" ? "rgba(34,197,94,.18)" : "none"}
                                stroke={BOX_COLOR[b.state]}
                                strokeWidth={Math.max(overlay.width, overlay.height) / 160}
                                strokeLinejoin="round"
                            />
                        ))}
                    </svg>
                )}
                {banner && (
                    <div
                        className="absolute inset-x-3 bottom-3 rounded-xl px-4 py-3 flex items-center gap-3 text-white shadow-lg"
                        style={{background: banner.status === "checked_in" ? "#15803d" : "#374151"}}
                    >
                        {banner.status === "checked_in" ? <LogIn size={26} aria-hidden="true"/> : <LogOut size={26} aria-hidden="true"/>}
                        <div className="min-w-0">
                            <p className="text-lg font-bold truncate">{banner.first_name}</p>
                            <p className="text-sm opacity-90">
                                {banner.repeat ? "Already " : ""}{banner.status === "checked_in" ? "checked in" : "checked out"}
                            </p>
                        </div>
                    </div>
                )}
            </div>

            <div className="p-4 flex flex-col gap-3">
                <p aria-live="polite" className="text-sm theme-subtext-color">
                    {scanError
                        ? <span style={{color: "var(--theme-danger)"}}>{scanError}</span>
                        : setup.kind === "starting" ? "Starting scanner…" : "Hold a member code up to the camera."}
                </p>
                {recent.length > 0 && (
                    <ul className="flex flex-col gap-1.5" aria-label="Recent scans">
                        {recent.map(r => (
                            <li key={r.id} className="flex items-center justify-between gap-3 text-sm">
                                <span className="theme-text truncate">{r.name}</span>
                                <span className="shrink-0 theme-subtext-color">
                                    {r.status === "checked_in" ? "In" : "Out"} · {new Date(r.at).toLocaleTimeString("en-US", {hour: "numeric", minute: "2-digit"})}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </Dialog>
    )
}

function closeKiosk(kioskId: string) {
    void fetch(`${API}/kiosk/scanner/${encodeURIComponent(kioskId)}`, {
        method: "DELETE",
        credentials: "include",
        keepalive: true,
    }).catch(() => {})
}
