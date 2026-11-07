import { useEffect, useRef, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { CheckCircle2, QrCode, XCircle } from "lucide-react"
import Skeleton from "@/components/ui/Skeleton"
import { useAppReady } from "@/contexts/appReadyContext"
import { buttonClass, cardClass, typeTitle } from "@/lib/uiClasses"

type State =
    | { kind: "working" }
    | { kind: "done", name: string, status: "checked_in" | "checked_out" }
    | { kind: "error", message: string }

/**
 * Landing page for the QR code a kiosk shows (`/checkin?t=<code>`). Opening it
 * while signed in claims the one-time code, which checks the member in or out.
 * A logged-out visitor goes through login first and rescans: codes live ~30s.
 */
export default function CheckinPage() {
    const markReady = useAppReady()
    const [params] = useSearchParams()
    const token = params.get("t")
    const [state, setState] = useState<State>(token ? { kind: "working" } : { kind: "error", message: "No check-in code found. Scan the QR code on the kiosk." })
    // Strict Mode runs effects twice; a code can only be claimed once.
    const sent = useRef(false)

    useEffect(() => { markReady() }, [markReady])

    useEffect(() => {
        if (!token || sent.current) return
        sent.current = true
        fetch(`${import.meta.env.VITE_BACKEND_URL}/attendance/qr_checkin`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
        })
            .then(async res => {
                if (res.ok) {
                    const data = await res.json() as { name: string, status: "checked_in" | "checked_out" }
                    setState({ kind: "done", ...data })
                    return
                }
                const detail = await res.json().then((d: { detail?: unknown }) => typeof d?.detail === "string" ? d.detail : null).catch(() => null)
                setState({ kind: "error", message: res.status === 410 ? "That code expired. Scan the QR code on the kiosk again." : detail ?? "Couldn't check you in." })
            })
            .catch(() => setState({ kind: "error", message: "Can't reach the server. Try again." }))
    }, [token])

    return (
        <div className="max-w-md mx-auto px-4 py-8 flex flex-col gap-4">
            <h1 className="text-2xl font-bold theme-h1-color">Kiosk check-in</h1>
            <section className={`${cardClass} theme-bg backdrop-blur-sm items-center text-center`} aria-live="polite">
                {state.kind === "working" && <div role="status" aria-label="Checking in" className="w-full flex flex-col gap-3"><Skeleton className="h-6 w-full" /><Skeleton className="h-6 w-2/3" /></div>}
                {state.kind === "done" && <>
                    <CheckCircle2 size={48} className="theme-text-contrast" aria-hidden="true" />
                    <h2 className={`${typeTitle} theme-text`}>{state.status === "checked_in" ? "Checked in" : "Checked out"}</h2>
                    <p className="text-sm theme-subtext-color">{state.name}</p>
                </>}
                {state.kind === "error" && <>
                    <XCircle size={48} className="theme-danger" aria-hidden="true" />
                    <h2 className={`${typeTitle} theme-text`}>Check-in failed</h2>
                    <p className="text-sm theme-subtext-color">{state.message}</p>
                </>}
                {state.kind !== "working" && <Link to="/dashboard" className={buttonClass({ variant: "outlined", className: "mt-2" })}><QrCode size={16} aria-hidden="true" />Back to dashboard</Link>}
            </section>
        </div>
    )
}
