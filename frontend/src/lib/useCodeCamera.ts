import { type RefObject, useEffect, useRef, useState } from "react"
import { centerOf, codeNumberOf, createCodeReader, memberCodeOf, type Point } from "@/lib/codeReader"

// The camera loop behind the task board (pages/BoardPage.tsx): reads members'
// codes, and hands each new appearance of one to `onCode` once. The same
// tracking as ScannerDialog: a code unseen for GONE_MS has left the frame, so
// holding it up again is a new scan, and a found-but-unreadable code near a
// known one keeps that one alive.
const GONE_MS = 1500
const SAME_PLACE = 0.25
const RETRY_MS = 1500

export type Facing = "user" | "environment"

/** What the camera is doing with the latest code it saw, for its outline colour. */
export type CameraState = "idle" | "reading" | "sending" | "done" | "failed"

interface Appearance {
    lastSeen: number
    center: Point
    state: "sending" | "done" | "failed"
    failedAt: number
}

export interface CodeCamera {
    videoRef: RefObject<HTMLVideoElement | null>
    /** Why there is no picture, or null. */
    error: string | null
    cameraCount: number
    state: CameraState
}

/**
 * @param onCode Called once per appearance of a member code, with the moment
 *   the frame was captured (Date.now() clock). Resolve true when it was handled;
 *   false lets the same appearance try again after a moment.
 * @param enabled Off stops the camera.
 */
export function useCodeCamera({ facing, enabled = true, onCode }: {
    facing: Facing
    enabled?: boolean
    onCode: (code: string, seenAt: number) => Promise<boolean>
}): CodeCamera {
    const videoRef = useRef<HTMLVideoElement>(null)
    const [error, setError] = useState<string | null>(null)
    const [cameraCount, setCameraCount] = useState(0)
    const [state, setState] = useState<CameraState>("idle")
    const [streaming, setStreaming] = useState(false)
    const onCodeRef = useRef(onCode)
    useEffect(() => { onCodeRef.current = onCode }, [onCode])

    // The stream for the chosen side.
    useEffect(() => {
        if (!enabled) return
        let cancelled = false
        let stream: MediaStream | null = null
        setError(null)
        if (!navigator.mediaDevices?.getUserMedia) {
            setError("This browser can't use the camera")
            return
        }
        navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
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
            setStreaming(true)
            // The full device list only appears once permission is granted.
            const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [])
            if (!cancelled) setCameraCount(devices.filter(d => d.kind === "videoinput").length)
        }).catch((err: unknown) => {
            if (cancelled) return
            const name = err instanceof DOMException ? err.name : ""
            setError(name === "NotAllowedError"
                ? "Camera access is blocked. Allow it in the browser's settings."
                : name === "NotFoundError" ? "No camera found" : "Couldn't start the camera")
        })
        return () => {
            cancelled = true
            setStreaming(false)
            stream?.getTracks().forEach(t => t.stop())
        }
    }, [facing, enabled])

    // Decode loop: one frame in flight at a time, the next grabbed as soon as the
    // last one answers, so it never queues stale frames.
    useEffect(() => {
        if (!enabled || !streaming) return
        const reader = createCodeReader()
        const appearances = new Map<string, Appearance>()
        let stopped = false
        let timer = 0
        let frameHandle = 0
        let frameVideo: HTMLVideoElement | null = null

        const submit = (a: Appearance, code: string, seenAt: number) => {
            a.state = "sending"
            setState("sending")
            onCodeRef.current(code, seenAt).then(ok => {
                a.state = ok ? "done" : "failed"
                a.failedAt = performance.now()
                if (!stopped) setState(a.state)
            }, () => {
                a.state = "failed"
                a.failedAt = performance.now()
                if (!stopped) setState("failed")
            })
        }

        const handle = (width: number, height: number, codes: { text: string | null, quad: Point[] }[], seenAt: number) => {
            const t = performance.now()
            const reach = SAME_PLACE * Math.hypot(width, height)
            let latest: CameraState | null = null

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
                        if (a.state === "failed" && t - a.failedAt > RETRY_MS) submit(a, code, seenAt)
                    } else {
                        a = { lastSeen: t, center, state: "sending", failedAt: 0 }
                        appearances.set(number, a)
                        submit(a, code, seenAt)
                    }
                    latest = a.state
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
                latest ??= nearest?.state ?? "reading"
            }

            for (const [number, a] of appearances) {
                if (t - a.lastSeen > GONE_MS * 4) appearances.delete(number)
            }
            const anyLive = [...appearances.values()].some(a => t - a.lastSeen < GONE_MS)
            setState(latest ?? (anyLive ? "reading" : "idle"))
        }

        const schedule = () => {
            if (stopped) return
            const video = videoRef.current
            if (video && "requestVideoFrameCallback" in video) {
                frameVideo = video
                frameHandle = video.requestVideoFrameCallback(() => void tick())
            } else {
                timer = window.setTimeout(() => void tick(), 60)
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
            setState("idle")
        }
    }, [enabled, streaming])

    return { videoRef, error, cameraCount, state }
}
