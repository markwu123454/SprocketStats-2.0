import { useEffect, useState } from "react"
import { ExternalLink } from "lucide-react"
import { useAuth, useOnboardedUser } from "@/contexts/authContext"
import Button from "@/components/ui/Button"
import Notice from "@/components/ui/Notice"
import { buttonClass, focusRing, typeTitle } from "@/lib/uiClasses"

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
            setError("Couldn't submit your response. Please try again.")
        } finally {
            setSubmitting(false)
        }
    }

    const titleId = "notification-gate-title"
    const bodyId = "notification-gate-body"

    return (
        // Required notice (modals.md): centred, z-100, deliberately not a Sheet so it can't be dismissed.
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50"
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={bodyId}
                className="w-full max-w-md rounded-2xl border p-6 flex flex-col gap-4 theme-bg theme-border shadow-lg"
            >
                <h2 id={titleId} className={`${typeTitle} theme-h1-color`}>{current.title}</h2>
                <p id={bodyId} className="text-sm theme-subtext-color leading-relaxed whitespace-pre-wrap">{current.body}</p>

                {current.link && (
                    <a
                        href={current.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setLinkOpened(true)}
                        className={buttonClass({ variant: "outlined" })}
                    >
                        <ExternalLink size={16} />
                        Open Link
                    </a>
                )}

                {hasOptions && (
                    <div className="flex flex-col gap-2" role={current.response_mode === "multi" ? "group" : "radiogroup"} aria-labelledby={titleId}>
                        {current.response_options.map(option => {
                            const active = selected.includes(option)
                            return (
                                <button
                                    key={option}
                                    type="button"
                                    disabled={gated}
                                    onClick={() => toggleOption(option)}
                                    role={current.response_mode === "multi" ? undefined : "radio"}
                                    aria-checked={current.response_mode === "multi" ? undefined : active}
                                    aria-pressed={current.response_mode === "multi" ? active : undefined}
                                    className={`rounded-lg border px-4 min-h-12 md:min-h-10 text-sm font-medium text-left transition-opacity disabled:opacity-40 disabled:cursor-not-allowed ${focusRing} ${active ? "theme-accent-fill theme-border" : "bg-transparent theme-text theme-outline"}`}
                                >
                                    {option}
                                </button>
                            )
                        })}
                    </div>
                )}

                {error && <Notice>{error}</Notice>}

                <div className="flex items-center gap-2 pt-1">
                    {!current.hard_block && (
                        <Button
                            variant="text"
                            size="footer"
                            onClick={() => current && setSkippedIds(prev => new Set(prev).add(current.id))}
                            className="mr-auto"
                        >
                            Later
                        </Button>
                    )}
                    <Button
                        size="footer"
                        onClick={() => void submit(hasOptions ? selected : [])}
                        disabled={!canSubmit || submitting}
                        className="ml-auto"
                    >
                        {submitting ? "Submitting…" : hasOptions ? "Submit" : "Got it"}
                    </Button>
                </div>
            </div>
        </div>
    )
}
