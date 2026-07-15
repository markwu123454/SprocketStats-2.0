import { useEffect, useState } from "react"
import { ExternalLink } from "lucide-react"
import { useAuth, useOnboardedUser } from "@/contexts/authContext"

const API = import.meta.env.VITE_BACKEND_URL

/**
 * Global gate for role-targeted notices, mounted once in `AppShell` so it sees
 * every authenticated page. `user.pending_notifications` is already ordered
 * hard-blocking-first by the backend; this renders a modal for the first one
 * not yet skipped this session.
 *
 * Hard-blocking notices have no way out except responding (no backdrop-dismiss,
 * no "Later"). Soft notices add a "Later" button that does *not* call the
 * server — it just hides the notice for this session; it reappears on the next
 * full `/auth/me` fetch (next page load), matching "wait till next view".
 *
 * If a notice has a link, the response action stays disabled until the link
 * button has been clicked at least once (mirrors the gating pattern in
 * `ScoutingPage.tsx`'s email-ack modal).
 */
export default function NotificationGate() {
    const user = useOnboardedUser()
    const { refreshUser } = useAuth()
    const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set())
    const [linkOpened, setLinkOpened] = useState(false)
    const [selected, setSelected] = useState<string[]>([])
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const current = user.pending_notifications.find(n => !skippedIds.has(n.id)) ?? null

    // Reset per-notice local state whenever the notice being shown changes.
    useEffect(() => {
        setLinkOpened(false)
        setSelected([])
        setError(null)
    }, [current?.id])

    if (!current) return null

    const hasOptions = current.response_options.length > 0
    const gated = current.link != null && !linkOpened
    const canSubmit = !gated && (hasOptions ? selected.length > 0 : true)

    function toggleOption(option: string) {
        if (!current) return
        if (current.response_mode === "multi") {
            setSelected(prev => prev.includes(option) ? prev.filter(o => o !== option) : [...prev, option])
        } else {
            setSelected([option])
        }
    }

    async function submit(response: string[]) {
        if (!current) return
        setSubmitting(true)
        setError(null)
        try {
            const res = await fetch(`${API}/notifications/${current.id}/respond`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ response }),
            })
            if (!res.ok) throw new Error("respond")
            await refreshUser()
        } catch {
            setError("Failed to submit your response. Please try again.")
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.6)" }}
        >
            <div className="w-full max-w-md rounded-2xl border p-6 flex flex-col gap-4 backdrop-blur-sm theme-bg theme-border">
                <h2 className="text-lg font-semibold theme-text-contrast">{current.title}</h2>
                <p className="text-sm theme-subtext-color leading-relaxed whitespace-pre-wrap">{current.body}</p>

                {current.link && (
                    <a
                        href={current.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setLinkOpened(true)}
                        className="flex items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold theme-text-contrast theme-border transition-opacity hover:opacity-80"
                        style={{ background: "color-mix(in oklch, var(--theme-button-bg) 80%, transparent)" }}
                    >
                        <ExternalLink size={16} />
                        Open Link
                    </a>
                )}

                {hasOptions && (
                    <div className="flex flex-col gap-2">
                        {current.response_options.map(option => {
                            const active = selected.includes(option)
                            return (
                                <button
                                    key={option}
                                    disabled={gated}
                                    onClick={() => toggleOption(option)}
                                    className="rounded-lg border px-4 py-2 text-sm font-medium text-left transition-opacity theme-border"
                                    style={{
                                        opacity: gated ? 0.4 : 1,
                                        cursor: gated ? "not-allowed" : "pointer",
                                        background: active ? "color-mix(in oklch, var(--theme-button-bg) 80%, transparent)" : "transparent",
                                        color: active ? "var(--theme-text-contrast)" : "var(--theme-text)",
                                    }}
                                >
                                    {option}
                                </button>
                            )
                        })}
                    </div>
                )}

                {error && (
                    <p className="text-sm px-3 py-2 rounded-lg border theme-subtext-color theme-border"
                       style={{ background: "color-mix(in oklch, var(--theme-border) 40%, transparent)" }}>
                        {error}
                    </p>
                )}

                <div className="flex gap-2 pt-1">
                    {!current.hard_block && (
                        <button
                            onClick={() => current && setSkippedIds(prev => new Set(prev).add(current.id))}
                            className="mr-auto rounded-lg px-4 py-2 text-sm font-medium theme-subtext-color transition-opacity hover:opacity-70"
                        >
                            Later
                        </button>
                    )}
                    <button
                        onClick={() => void submit(hasOptions ? selected : [])}
                        disabled={!canSubmit || submitting}
                        className="rounded-lg border px-4 py-2 text-sm font-semibold transition-opacity theme-text-contrast theme-border"
                        style={{
                            background: "color-mix(in oklch, var(--theme-button-bg) 80%, transparent)",
                            opacity: canSubmit && !submitting ? 1 : 0.35,
                            cursor: canSubmit && !submitting ? "pointer" : "not-allowed",
                        }}
                    >
                        {submitting ? "Submitting…" : hasOptions ? "Submit" : "Got it"}
                    </button>
                </div>
            </div>
        </div>
    )
}
