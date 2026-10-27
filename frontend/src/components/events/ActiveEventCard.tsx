import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Check } from "lucide-react"
import Dropdown from "@/components/ui/Dropdown"
import DayChips from "@/components/events/DayChips"
import { eventDays, hasEventPage, isTabHidden, STATUS_META, type ResolvedEvent } from "@/lib/events"
import {
    checkInToEvent, fetchCheckInStatus, fetchEventUpdate,
    type EventInfo, type TBAMatch,
} from "@/lib/eventApi"
import { formatUnix, getAlliance, matchLabel, nextMatchFor, TEAM_KEY } from "@/lib/eventMatches"
import { ASSIGNABLE_ROLES, validatePhone, type AssignableRole } from "@/lib/rosterRoles"
import { DANGER_RED, tintColor } from "@/lib/taskFormat"

const cardStyle = { background: "var(--theme-bg)", borderColor: "var(--theme-border)" }

// Primary CTA per DESIGN_SYSTEM.md §3.1: `theme-bg` fill (not the
// accent-filled `theme-text-contrast` background some older pages use),
// `theme-border`, `theme-text-contrast` label, radius-surface, >=44px tall.
const primaryButtonClass =
    "theme-bg border theme-border theme-text-contrast rounded-xl text-sm font-semibold h-11 px-4 " +
    "inline-flex items-center justify-center gap-2 outline-none focus:ring-2 transition-opacity " +
    "disabled:opacity-40 disabled:cursor-not-allowed"

const ghostButtonClass =
    "h-11 px-2 rounded-lg text-sm theme-subtext-color hover:underline outline-none focus:ring-2 " +
    "disabled:opacity-40 disabled:cursor-not-allowed"

interface ActiveEventCardProps {
    active: ResolvedEvent
    hasHub: boolean
    eventKey: string | undefined
    /** Bootstrap's `current_event`, already confirmed by the caller to match
     *  `eventKey` -- or null when there's no usable seed. */
    seed: EventInfo | null
    userId: string
}

export default function ActiveEventCard({ active, hasHub, eventKey, seed, userId }: ActiveEventCardProps) {
    const [matches, setMatches] = useState<TBAMatch[] | null>(seed?.matches ?? null)
    const [checkedIn, setCheckedIn] = useState<boolean | null>(
        seed ? (seed.roster?.some(r => r.user_id === userId) ?? null) : null
    )
    const [showForm, setShowForm] = useState(false)
    const [role, setRole] = useState<AssignableRole>("attending")
    // All days selected by default. Deliberately not reset on cancel -- if
    // the user has already picked specific days and backs out, reopening
    // the form keeps that selection rather than silently reverting it.
    const [days, setDays] = useState<string[]>(() => eventDays(active))
    const [daysError, setDaysError] = useState<string | null>(null)
    const [phone, setPhone] = useState("")
    const [phoneError, setPhoneError] = useState<string | null>(null)
    const [checkingIn, setCheckingIn] = useState(false)
    const [checkInError, setCheckInError] = useState<string | null>(null)

    const eventDayList = eventDays(active)

    // The card also shows ahead of an event once its check-in opens -- then
    // it's a check-in prompt, with no match info to show yet.
    const happening = active.status === "current"
    const headerLabel = happening ? STATUS_META.current.label : "Check-in open"
    const showMatches = happening && !isTabHidden(active, "comp")
    const hasPage = hasEventPage(active)

    // Match data for the next-match row -- seeded from bootstrap, then kept
    // fresh with a 60s poll (only runs once `hasHub` is true).
    useEffect(() => {
        if (!hasHub || !eventKey) return
        let cancelled = false
        fetchEventUpdate(eventKey)
            .then(update => { if (!cancelled) setMatches(update.matches) })
            .catch(() => {})
        const id = setInterval(() => {
            fetchEventUpdate(eventKey)
                .then(update => { if (!cancelled) setMatches(update.matches) })
                .catch(() => {})
        }, 60_000)
        return () => { cancelled = true; clearInterval(id) }
    }, [hasHub, eventKey])

    // Confirms (or corrects) the bootstrap-seeded check-in guess. On failure
    // with no seed, fall back to "not checked in" rather than leaving the
    // Check in button stuck disabled forever -- the check-in POST is
    // idempotent, so letting the user press it is safe.
    useEffect(() => {
        if (!hasHub || !eventKey) return
        let cancelled = false
        fetchCheckInStatus(eventKey)
            .then(res => { if (!cancelled) setCheckedIn(res.checked_in) })
            .catch(() => { if (!cancelled) setCheckedIn(prev => prev ?? false) })
        return () => { cancelled = true }
    }, [hasHub, eventKey])

    function toggleDay(day: string) {
        setDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day])
        setDaysError(null)
    }

    function handleCheckIn() {
        const err = validatePhone(phone)
        if (err) { setPhoneError(err); return }
        if (days.length === 0) { setDaysError("Pick at least one day."); return }
        if (!eventKey) return
        setCheckingIn(true)
        setCheckInError(null)
        checkInToEvent(eventKey, { role, phone: phone.trim() === "" ? null : phone.trim(), days: [...days].sort() })
            .then(() => { setCheckedIn(true); setCheckingIn(false); setShowForm(false) })
            .catch((err: unknown) => {
                setCheckingIn(false)
                // Only surface the backend's own message for a 4xx (e.g. a
                // bad phone number) -- a raw "HTTP 500" or "Failed to fetch"
                // isn't something the user can act on.
                const status = (err as { status?: number } | null)?.status
                const detail = err instanceof Error ? err.message : null
                setCheckInError(status && status >= 400 && status < 500 && detail ? detail : "Couldn't check you in. Try again.")
            })
    }

    function handleCancel() {
        setShowForm(false)
        setCheckInError(null)
        setPhoneError(null)
        setDaysError(null)
    }

    const nextMatch = matches ? nextMatchFor(matches, TEAM_KEY) : null
    const nextMatchText = nextMatch
        ? `${matchLabel(nextMatch)} · ${formatUnix(nextMatch.predicted_time ?? nextMatch.scheduled_time)} · ${getAlliance(nextMatch, TEAM_KEY) === "red" ? "Red" : "Blue"} alliance`
        : "No upcoming match scheduled"

    return (
        <div className="rounded-xl border p-5 flex flex-col gap-3 backdrop-blur-sm" style={cardStyle}>
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="min-w-0">
                    <span
                        className="text-[10px] font-bold tracking-wider uppercase block mb-0.5"
                        style={{ color: STATUS_META.current.color }}
                    >
                        {headerLabel}
                    </span>
                    <p className="text-base font-bold theme-text truncate">{active.name}</p>
                    <p className="text-sm theme-subtext-color mt-0.5">{active.dateLabel} · {active.location}</p>
                </div>

                {hasHub && !showForm && (
                    <div className="flex items-center gap-3 shrink-0">
                        {checkedIn ? (
                            <>
                                <span className="inline-flex items-center gap-1.5 text-sm theme-subtext-color">
                                    <Check size={15} className="theme-text-contrast" />
                                    You're checked in
                                </span>
                                {showMatches ? (
                                    <Link to={`/events/${eventKey}/comp`} className={primaryButtonClass}>
                                        Go to matches
                                    </Link>
                                ) : hasPage ? (
                                    <Link to={`/events/${eventKey}`} className={primaryButtonClass}>
                                        View event
                                    </Link>
                                ) : null}
                            </>
                        ) : (
                            <button
                                type="button"
                                onClick={() => setShowForm(true)}
                                disabled={checkedIn === null}
                                className={primaryButtonClass}
                            >
                                Check in
                            </button>
                        )}
                    </div>
                )}
            </div>

            {hasHub && showForm && !checkedIn && (
                <div className="flex flex-col gap-3">
                    {/* Dropdown's trigger doesn't take an id/aria-label of its own
                        (see Dropdown.d.ts) -- role="group" + aria-labelledby is
                        the documented way to associate a label with it instead. */}
                    <div className="flex flex-col gap-1" role="group" aria-labelledby="checkin-role-label">
                        <label id="checkin-role-label" className="text-sm font-semibold theme-text">Role</label>
                        <Dropdown
                            value={role}
                            options={ASSIGNABLE_ROLES}
                            onChange={v => setRole(v as AssignableRole)}
                            disabled={checkingIn}
                            triggerClassName="rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-2 transition theme-bg theme-border theme-text"
                        />
                    </div>

                    <DayChips
                        label="Days you'll be there"
                        days={eventDayList}
                        selected={days}
                        onToggle={toggleDay}
                        disabled={checkingIn}
                        error={daysError}
                    />

                    <div className="flex flex-col gap-1">
                        <label htmlFor="checkin-phone" className="text-sm font-semibold theme-text">
                            Phone number (optional)
                        </label>
                        <input
                            id="checkin-phone"
                            type="tel"
                            inputMode="tel"
                            autoComplete="tel"
                            value={phone}
                            disabled={checkingIn}
                            onChange={e => { setPhone(e.target.value); setPhoneError(null) }}
                            className="rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-2 transition theme-bg theme-text disabled:opacity-60"
                            style={{ borderColor: phoneError ? DANGER_RED : "var(--theme-border)" }}
                        />
                        {phoneError ? (
                            <p role="alert" className="text-xs" style={{ color: DANGER_RED }}>{phoneError}</p>
                        ) : (
                            <p className="text-xs theme-subtext-color">Shown to the team on this event's roster.</p>
                        )}
                    </div>

                    <div className="flex items-center gap-3">
                        <button type="button" onClick={handleCheckIn} disabled={checkingIn} className={primaryButtonClass}>
                            {checkingIn ? "Checking in…" : "Check in"}
                        </button>
                        <button type="button" onClick={handleCancel} disabled={checkingIn} className={ghostButtonClass}>
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {hasHub && showMatches && matches !== null && (
                nextMatch ? (
                    <p className="text-sm theme-text">
                        <span className="theme-subtext-color">Next match</span> {nextMatchText}
                    </p>
                ) : (
                    <p className="text-sm theme-subtext-color">{nextMatchText}</p>
                )
            )}

            {hasHub && checkInError && (
                <p
                    role="alert"
                    className="text-xs rounded-lg px-3 py-2"
                    style={{
                        color: DANGER_RED,
                        background: tintColor(DANGER_RED, 10),
                        border: `1px solid ${tintColor(DANGER_RED, 40)}`,
                    }}
                >
                    {checkInError}
                </p>
            )}

            {hasHub && hasPage && checkedIn === false && (
                <Link
                    to={`/events/${eventKey}`}
                    className="inline-flex items-center min-h-11 self-start rounded-lg text-sm theme-text-contrast hover:underline outline-none focus:ring-2"
                >
                    View event
                </Link>
            )}
        </div>
    )
}
