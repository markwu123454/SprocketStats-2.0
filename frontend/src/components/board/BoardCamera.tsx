import { CameraOff, SwitchCamera } from "lucide-react"
import type { CameraState, CodeCamera, Facing } from "@/lib/useCodeCamera"
import { focusRing } from "@/lib/uiClasses"

// The same outline colours as the check-in scanner: white while reading,
// yellow sending, green done, red failed.
const RING: Record<CameraState, string> = {
    idle: "transparent",
    reading: "rgba(255,255,255,.85)",
    sending: "#facc15",
    done: "#22c55e",
    failed: "#ef4444",
}

/** The task board's camera: the live picture, ringed in the colour of what it's doing with a code. */
export default function BoardCamera({ camera, facing, onFlip, className = "" }: {
    camera: CodeCamera
    facing: Facing
    onFlip?: () => void
    className?: string
}) {
    return (
        <div className={`relative overflow-hidden rounded-xl bg-black ${className}`}>
            <video
                ref={camera.videoRef}
                muted
                playsInline
                aria-hidden="true"
                className="size-full object-cover"
                // The front camera reads like a mirror; the decoder still gets the raw frame.
                style={facing === "user" ? { transform: "scaleX(-1)" } : undefined}
            />
            {camera.error && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center bg-black/80">
                    <CameraOff className="size-6 text-white/70" aria-hidden="true"/>
                    <p className="text-xs font-semibold text-white">{camera.error}</p>
                </div>
            )}
            <div
                aria-hidden="true"
                className="absolute inset-0 rounded-[inherit] pointer-events-none transition-shadow"
                style={{ boxShadow: `inset 0 0 0 4px ${RING[camera.state]}` }}
            />
            {onFlip && camera.cameraCount > 1 && (
                <button
                    type="button"
                    onClick={onFlip}
                    aria-label={facing === "user" ? "Use back camera" : "Use front camera"}
                    className={`absolute top-1.5 right-1.5 size-9 flex items-center justify-center rounded-lg bg-black/50 text-white hover:bg-black/70 ${focusRing}`}
                >
                    <SwitchCamera className="size-5" aria-hidden="true"/>
                </button>
            )}
        </div>
    )
}
