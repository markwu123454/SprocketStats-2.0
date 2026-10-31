import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Check } from "lucide-react"
import Dropdown from "@/components/ui/Dropdown"
import DayChips from "@/components/events/DayChips"
import {
    checkInRolesOf, defaultCheckInRole, eventDays, hasEventPage, isTabHidden, STATUS_META, usesCheckIn,
    type ResolvedEvent,
} from "@/lib/events"
import {
    checkInToEvent, fetchCheckInStatus, fetchEventUpdate, setCheckInDismissed,
    type EventInfo, type TBAMatch,
} from "@/lib/eventApi"
import { formatUnix, getAlliance, matchLabel, nextMatchFor, TEAM_KEY } from "@/lib/eventMatches"
import { validatePhone } from "@/lib/rosterRoles"
import { useDiscardGuard } from "@/lib/useDiscardGuard"
import Button from "@/components/ui/Button"
import Notice from "@/components/ui/Notice"
import { buttonClass, fieldErrorClass, fieldLabelClass, helperClass, inputClass, typeH2, typeTitle } from "@/lib/uiClasses"

const cardStyle = { background: "var(--theme-bg)", borderColor: "var(--theme-border)" }

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
    const [role, setRole] = useState<string>(() => defaultCheckInRole(active))
    // null until the status fetch says -- treated as not dismissed meanwhile.
    const [dismissed, setDismissed] = useState<boolean | null>(null)
    // All days selected by default. Deliberately not reset on cancel -- if
    // the user has already picked specific days and backs out, reopening
    // the form keeps that selection rather than silently reverting it.
    const [days, setDays] = useState<string[]>(() => eventDays(active))
    const [daysError, setDaysError] = useState<string | null>(null)
    const [phone, setPhone] = useState("")
    const [phoneError, setPhoneError] = useState<string | null>(null)
    const [checkingIn, setCheckingIn] = useState(false)
    const [checkInError, setCheckInError] = useState<string | null>(null)
    // Only the typed phone number counts as an edit; role and days start from sensible defaults.
    const confirmDiscard = useDiscardGuard(showForm && phone !== "")

    const eventDayList = eventDays(active)

    // The card also shows ahead of an event once its check-in opens -- then
    // it's a check-in prompt, with no match info to show yet.
    const happening = active.status === "current"
    const headerLabel = happening ? STATUS_META.current.label : "Check-in open"
    const showMatches = happening && !isTabHidden(active, "comp")
    const hasPage = hasEventPage(active)
    // An event that doesn't use check-in still gets the card while it's
    // happening, just without the check-in prompt.
    const checkInOn = usesCheckIn(active)
    // The prompt itself (Check in button, form) -- off when the event doesn't
    // use check-in, or this member dismissed it.
    const promptOn = checkInOn && !dismissed
    const roleOptions = checkInRolesOf(active).map(r => ({ value: r.key, label: r.label }))

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
        if (!hasHub || !eventKey || !checkInOn) return
        let cancelled = false
        fetchCheckInStatus(eventKey)
            .then(res => { if (!cancelled) { setCheckedIn(res.checked_in); setDismissed(res.dismissed) } })
            .catch(() => { if (!cancelled) setCheckedIn(prev => prev ?? false) })
        return () => { cancelled = true }
    }, [hasHub, eventKey, checkInOn])

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

    // Optimistic either way; a failed request puts it back and says so.
    function changeDismissed(next: boolean) {
        if (!eventKey) return
        setDismissed(next)
        setCheckInError(null)
        if (!next) setShowForm(true)
        setCheckInDismissed(eventKey, next).catch(() => {
            setDismissed(!next)
            if (!next) setShowForm(false)
            setCheckInError(next ? "Couldn't dismiss check-in. Try again." : "Couldn't bring back check-in. Try again.")
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

    // Ahead of the event the card is only a check-in prompt, so dismissing
    // it hides the whole card. Once the event is happening the card comes
    // back (minus the prompt) with a link to check in after all.
    if (dismissed && !happening && !checkedIn) return null

    return (
        <div className="rounded-xl border p-5 flex flex-col gap-3 backdrop-blur-sm" style={cardStyle}>
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="min-w-0">
                    <span
                        className={`${typeH2} block mb-0.5`}
                        style={{ color: STATUS_META.current.color }}
                    >
                        {headerLabel}
                    </span>
                    <p className={`${typeTitle} theme-text truncate`}>{active.name}</p>
                    <p className="text-sm theme-subtext-color mt-0.5">{active.dateLabel} · {active.location}</p>
                </div>

                {hasHub && !showForm && (
                    <div className="flex flex-wrap items-center gap-3 sm:shrink-0">
                        {checkedIn || !promptOn ? (
                            <>
                                {checkInOn && checkedIn && (
                                    <span className="inline-flex items-center gap-1.5 text-sm theme-subtext-color">
                                        <Check size={15} className="theme-text-contrast" />
                                        You're checked in
                                    </span>
                                )}
                                {showMatches ? (
                                    <Link to={`/events/${eventKey}/comp`} className={buttonClass()}>
                                        Go to matches
                                    </Link>
                                ) : hasPage ? (
                                    <Link to={`/events/${eventKey}`} className={buttonClass()}>
                                        View event
                                    </Link>
                                ) : null}
                            </>
                        ) : (
                            <>
                                <Button variant="text" onClick={() => changeDismissed(true)} disabled={checkedIn === null}>
                                    Dismiss
                                </Button>
                                <Button onClick={() => setShowForm(true)} disabled={checkedIn === null}>
                                    Check in
                                </Button>
                            </>
                        )}
                    </div>
                )}
            </div>

            {hasHub && promptOn && showForm && !checkedIn && (
                <div className="flex flex-col gap-3">
                    {/* Dropdown's trigger doesn't take an id/aria-label of its own
                        (see Dropdown.d.ts) -- role="group" + aria-labelledby is
                        the documented way to associate a label with it instead. */}
                    <div className="flex flex-col gap-1" role="group" aria-labelledby="checkin-role-label">
                        <label id="checkin-role-label" className={fieldLabelClass}>Role</label>
                        <Dropdown
                            value={role}
                            options={roleOptions}
                            onChange={setRole}
                            disabled={checkingIn}
                            triggerClassName={inputClass}
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
                        <label htmlFor="checkin-phone" className={fieldLabelClass}>
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
                            className={`${inputClass} ${phoneError ? "theme-border-danger" : ""}`}
                        />
                        {phoneError ? (
                            <p role="alert" className={fieldErrorClass}>{phoneError}</p>
                        ) : (
                            <p className={helperClass}>Shown to the team on this event's roster.</p>
                        )}
                    </div>

                    <div className="flex items-center justify-end gap-3">
                        <Button
                            variant="text"
                            onClick={() => void confirmDiscard().then(ok => {
                                if (!ok) return
                                setPhone("") // discarding drops the typed number too
                                handleCancel()
                            })}
                            disabled={checkingIn}
                        >
                            Cancel
                        </Button>
                        <Button onClick={handleCheckIn} disabled={checkingIn}>
                            {checkingIn ? "Checking in…" : "Check in"}
                        </Button>
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
                <Notice>{checkInError}</Notice>
            )}

            {hasHub && checkInOn && dismissed && !checkedIn && (
                <Button variant="text" className="self-start" onClick={() => changeDismissed(false)}>
                    Check in after all
                </Button>
            )}

            {hasHub && hasPage && promptOn && checkedIn === false && (
                <Link
                    to={`/events/${eventKey}`}
                    className={buttonClass({ variant: "text", className: "self-start" })}
                >
                    View event
                </Link>
            )}
        </div>
    )
}
