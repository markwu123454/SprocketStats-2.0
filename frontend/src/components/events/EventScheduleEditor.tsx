import { useState } from "react"
import Checkbox from "@/components/ui/Checkbox"
import { Plus, X } from "lucide-react"
import { HIDEABLE_TABS, checkInRolesOf, hasEventPage, usesCheckIn, type EventEntry, type HubTab } from "@/lib/events"
import { createEvent, patchEventSchedule, type EventSchedulePatch } from "@/lib/eventApi"
import { saveErrorMessage } from "@/lib/eventContent"
import { DANGER_RED, tintColor } from "@/lib/taskFormat"

// Same button treatments as ActiveEventCard / RosterPage's editor panel.
const primaryButtonClass =
    "theme-bg border theme-border theme-text-contrast rounded-xl text-sm font-semibold h-11 px-4 " +
    "inline-flex items-center justify-center gap-2 outline-none focus:ring-2 transition-opacity " +
    "disabled:opacity-40 disabled:cursor-not-allowed"

const ghostButtonClass =
    "h-11 px-2 rounded-lg text-sm theme-subtext-color hover:underline outline-none focus:ring-2 " +
    "disabled:opacity-40 disabled:cursor-not-allowed"

const inputClass =
    "rounded-lg border theme-border px-3 py-2.5 text-sm outline-none focus:ring-2 transition theme-bg theme-text " +
    "disabled:opacity-60 min-w-0"

// Mirror MAX_DESCRIPTION / MAX_CHECKIN_ROLES / MAX_ROLE_LABEL in backend/db/events.py.
const MAX_DESCRIPTION = 5000
const MAX_ROLES = 20
const MAX_ROLE_LABEL = 40

interface RoleDraft { id: number; key?: string; label: string }

// Same rules the backend enforces, so most mistakes never reach the server.
function validateRoles(roles: RoleDraft[]): string | null {
    if (roles.length === 0) return "Add at least one check-in role."
    const names = roles.map(r => r.label.trim())
    if (names.some(n => !n)) return "Check-in roles need a name."
    if (names.some(n => n.length > MAX_ROLE_LABEL)) return `Role names must be ${MAX_ROLE_LABEL} characters or fewer.`
    if (new Set(names.map(n => n.toLowerCase())).size !== names.length) return "Check-in role names must be different."
    return null
}

const TAB_LABEL: Record<HubTab, string> = {
    itinerary: "Itinerary",
    packing: "Packing",
    roster: "Roster",
    comp: "Comp",
    tasks: "Tasks",
}

// A schedule value is "YYYY-MM-DD" (all day) or "YYYY-MM-DDTHH:MM[...]" --
// edited as a date input plus an optional time input, so an all-day value
// round-trips as all-day instead of gaining a midnight time.
interface Moment { date: string; time: string }

function splitMoment(value: string | undefined): Moment {
    if (!value) return { date: "", time: "" }
    return { date: value.slice(0, 10), time: value.length > 10 ? value.slice(11, 16) : "" }
}

function joinMoment({ date, time }: Moment): string | null {
    if (!date) return null
    return time ? `${date}T${time}` : date
}

const MAX_TEXT = 120
const TYPE_SUGGESTIONS = ["regional", "district", "outreach", "meeting", "workshop", "off-season"]

interface EventScheduleEditorProps {
    /** The event to edit; omit to create a new one. */
    event?: EventEntry & { id: number }
    onSaved: (updated: EventEntry) => void
    onCancel: () => void
}

export default function EventScheduleEditor({ event: existing, onSaved, onCancel }: EventScheduleEditorProps) {
    const creating = !existing
    // A blank stand-in keeps every draft initializer below working unchanged.
    const event = existing ?? ({ name: "", start: "", location: "", type: "", id: -1 } as EventEntry & { id: number })
    const [name, setName] = useState(event.name)
    const [location, setLocation] = useState(event.location)
    const [type, setType] = useState(event.type)
    const [start, setStart] = useState(() => splitMoment(event.start))
    const [end, setEnd] = useState(() => splitMoment(event.end))
    const [checkin, setCheckin] = useState(() => splitMoment(event.checkinOpens))
    const [hidden, setHidden] = useState<HubTab[]>(event.hiddenTabs ?? [])
    const [description, setDescription] = useState(event.description ?? "")
    const [checkInOn, setCheckInOn] = useState(usesCheckIn(event))
    // `id` is only a stable React key for the row; `key` is the stored role
    // key (absent for a role added here, which the server assigns).
    const [roles, setRoles] = useState<RoleDraft[]>(() =>
        checkInRolesOf(event).map((r, i) => ({ id: i, key: r.key, label: r.label }))
    )
    const [nextRoleId, setNextRoleId] = useState(() => checkInRolesOf(event).length)

    function updateRole(id: number, label: string) {
        setRoles(prev => prev.map(r => r.id === id ? { ...r, label } : r))
    }

    function removeRole(id: number) {
        setRoles(prev => prev.filter(r => r.id !== id))
    }

    function addRole() {
        setRoles(prev => [...prev, { id: nextRoleId, label: "" }])
        setNextRoleId(n => n + 1)
    }
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const hasHub = !creating && !!(event.hubKey || event.tbaKey || event.url)
    // Comp only exists for TBA events -- not offered as a toggle otherwise.
    const tabChoices = HIDEABLE_TABS.filter(t => t !== "comp" || event.tbaKey)
    // Previewed against the unsaved draft, so the warning tracks the form.
    const willHavePage = hasEventPage({ ...event, description, hiddenTabs: hidden })

    function toggleTab(tab: HubTab) {
        setHidden(prev => prev.includes(tab) ? prev.filter(t => t !== tab) : [...prev, tab])
    }

    async function handleSave() {
        const nextName = name.trim()
        if (!nextName) { setError("Give the event a name."); return }
        const nextType = type.trim()
        if (!nextType) { setError("Pick or type an event type."); return }
        const nextLocation = location.trim()
        const nextStart = joinMoment(start)
        if (!nextStart) { setError("Start date is required."); return }

        // Only send what changed, compared against the same normalization
        // the inputs apply (so an untouched "09:00:00" isn't a change).
        const patch: EventSchedulePatch = {}
        if (nextName !== event.name) patch.name = nextName
        if (nextType !== event.type) patch.type = nextType
        if (nextLocation !== event.location) patch.location = nextLocation
        if (nextStart !== joinMoment(splitMoment(event.start))) patch.start = nextStart
        const nextEnd = joinMoment(end)
        if (nextEnd !== joinMoment(splitMoment(event.end))) patch.end = nextEnd
        const nextCheckin = joinMoment(checkin)
        if (nextCheckin !== joinMoment(splitMoment(event.checkinOpens))) patch.checkin_opens = nextCheckin
        const nextHidden = HIDEABLE_TABS.filter(t => hidden.includes(t))
        const prevHidden = HIDEABLE_TABS.filter(t => event.hiddenTabs?.includes(t))
        if (nextHidden.join() !== prevHidden.join()) patch.hidden_tabs = nextHidden
        const nextDescription = description.trim() || null
        if (description.length > MAX_DESCRIPTION) { setError(`Overview text must be ${MAX_DESCRIPTION} characters or fewer.`); return }
        if (nextDescription !== (event.description?.trim() || null)) patch.description = nextDescription
        if (checkInOn !== usesCheckIn(event)) patch.checkin_enabled = checkInOn

        const roleErr = validateRoles(roles)
        if (roleErr) { setError(roleErr); return }
        const nextRoles = roles.map(r => (r.key ? { key: r.key, label: r.label.trim() } : { label: r.label.trim() }))
        const prevRoles = checkInRolesOf(event)
        const rolesChanged = nextRoles.length !== prevRoles.length
            || nextRoles.some((r, i) => r.key !== prevRoles[i].key || r.label !== prevRoles[i].label)
        if (rolesChanged) patch.checkin_roles = nextRoles

        if (!creating && Object.keys(patch).length === 0) { onCancel(); return }

        setSaving(true)
        setError(null)
        try {
            onSaved(creating
                ? await createEvent({
                    name: nextName, type: nextType, location: nextLocation, start: nextStart,
                    end: nextEnd, checkin_opens: checkInOn ? nextCheckin : null, checkin_enabled: checkInOn,
                })
                : await patchEventSchedule(event.id, patch))
        } catch (e) {
            setError(saveErrorMessage(e, creating ? "Couldn't create this event. Try again." : "Couldn't save this event. Try again."))
            setSaving(false)
        }
    }

    return (
        <div className="flex flex-col gap-4">
            {!creating && <p className="text-sm font-semibold theme-text truncate">Edit {event.name}</p>}

            {error && (
                <p
                    role="alert"
                    className="text-xs rounded-lg px-3 py-2"
                    style={{ color: DANGER_RED, background: tintColor(DANGER_RED, 10), border: `1px solid ${tintColor(DANGER_RED, 40)}` }}
                >
                    {error}
                </p>
            )}

            <TextField label="Name" value={name} onChange={setName} disabled={saving} placeholder="e.g. Cascade Regional" />
            <TextField label="Type" value={type} onChange={setType} disabled={saving} placeholder="e.g. regional, outreach" suggestions={TYPE_SUGGESTIONS} />
            <TextField label="Location" value={location} onChange={setLocation} disabled={saving} placeholder="City, venue or address" />
            <MomentField label="Starts" value={start} onChange={setStart} disabled={saving} />
            <MomentField label="Ends" hint="Leave empty for a single-day event." value={end} onChange={setEnd} disabled={saving} clearable />
            <label className="inline-flex items-center gap-2 min-h-11 text-sm theme-text cursor-pointer self-start">
                <Checkbox checked={checkInOn} onChange={() => setCheckInOn(v => !v)} />
                Members check in to this event
            </label>
            {checkInOn && (
                <MomentField
                    label="Check-in opens"
                    hint="Leave empty to open check-in when the event starts."
                    value={checkin}
                    onChange={setCheckin}
                    disabled={saving}
                    clearable
                />
            )}
            {checkInOn && (
                <fieldset className="flex flex-col gap-2">
                    <legend className="text-sm font-semibold theme-text mb-1">Check-in roles</legend>
                    <p className="text-xs theme-subtext-color -mt-1">
                        Members pick one when they check in. Renaming a role keeps everyone already checked in under it.
                    </p>
                    {roles.map((r, i) => (
                        <div key={r.id} className="flex items-center gap-2">
                            <input
                                value={r.label}
                                aria-label={`Role ${i + 1} name`}
                                disabled={saving}
                                maxLength={MAX_ROLE_LABEL}
                                onChange={e => updateRole(r.id, e.target.value)}
                                className={`${inputClass} flex-1`}
                            />
                            <button
                                type="button"
                                aria-label={`Remove ${r.label || "role"}`}
                                disabled={saving || roles.length === 1}
                                onClick={() => removeRole(r.id)}
                                className="inline-flex items-center justify-center w-11 h-11 shrink-0 rounded-lg opacity-60 hover:opacity-100 transition-opacity outline-none focus:ring-2 disabled:opacity-30"
                            >
                                <X size={16} className="theme-subtext-color" />
                            </button>
                        </div>
                    ))}
                    {roles.length < MAX_ROLES && (
                        <button type="button" onClick={addRole} disabled={saving} className={`${ghostButtonClass} self-start inline-flex items-center gap-1`}>
                            <Plus size={14} />
                            Add role
                        </button>
                    )}
                </fieldset>
            )}

            {hasHub && (
                <div className="flex flex-col gap-1">
                    <label htmlFor={`event-desc-${event.id}`} className="text-sm font-semibold theme-text">Overview text</label>
                    <textarea
                        id={`event-desc-${event.id}`}
                        value={description}
                        disabled={saving}
                        onChange={e => setDescription(e.target.value)}
                        rows={4}
                        maxLength={MAX_DESCRIPTION}
                        placeholder="Introduce the event: what it is, who should come, what to bring…"
                        className={`${inputClass} resize-y`}
                    />
                    <p className="text-xs theme-subtext-color">Shown at the top of the event's Overview page.</p>
                </div>
            )}

            {hasHub && (
                <fieldset className="flex flex-col gap-2">
                    <legend className="text-sm font-semibold theme-text mb-1">Event pages</legend>
                    <p className="text-xs theme-subtext-color -mt-1">Unchecked pages are hidden from this event. Overview shows whenever the event has a page.</p>
                    <div className="flex flex-wrap gap-x-5 gap-y-2">
                        {tabChoices.map(tab => (
                            <label key={tab} className="inline-flex items-center gap-2 min-h-11 text-sm theme-text cursor-pointer">
                                <Checkbox checked={!hidden.includes(tab)} onChange={() => toggleTab(tab)} />
                                {TAB_LABEL[tab]}
                            </label>
                        ))}
                    </div>
                    {!willHavePage && (
                        <p className="text-xs theme-subtext-color">
                            With no Overview text and every page unchecked, this event won't have a page.
                            {checkInOn && " Members can still check in from the dashboard."}
                        </p>
                    )}
                </fieldset>
            )}

            {/* Sticks to the bottom of the sheet so Save stays under the thumb
                on a long form. */}
            <div className="sticky bottom-0 -mx-4 px-4 py-3 -mb-4 flex items-center gap-3 border-t theme-border" style={{ background: "var(--theme-bg)" }}>
                <button type="button" onClick={() => void handleSave()} disabled={saving} className={primaryButtonClass}>
                    {saving ? "Saving…" : creating ? "Create event" : "Save"}
                </button>
                <button type="button" onClick={onCancel} disabled={saving} className={ghostButtonClass}>
                    Cancel
                </button>
            </div>
        </div>
    )
}

interface MomentFieldProps {
    label: string
    hint?: string
    value: Moment
    onChange: (next: Moment) => void
    disabled: boolean
    clearable?: boolean
}

function MomentField({ label, hint, value, onChange, disabled, clearable }: MomentFieldProps) {
    return (
        <div className="flex flex-col gap-1" role="group" aria-label={label}>
            <span className="text-sm font-semibold theme-text">{label}</span>
            <div className="flex flex-wrap items-center gap-2">
                <input
                    type="date"
                    aria-label={`${label} date`}
                    value={value.date}
                    disabled={disabled}
                    onChange={e => onChange({ ...value, date: e.target.value })}
                    className={inputClass}
                />
                <input
                    type="time"
                    aria-label={`${label} time (optional)`}
                    value={value.time}
                    disabled={disabled || !value.date}
                    onChange={e => onChange({ ...value, time: e.target.value })}
                    className={inputClass}
                />
                {clearable && value.date && (
                    <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onChange({ date: "", time: "" })}
                        className={ghostButtonClass}
                    >
                        Clear
                    </button>
                )}
            </div>
            <p className="text-xs theme-subtext-color">{hint ?? "Time is optional. Leave it empty for all day."}</p>
        </div>
    )
}

interface TextFieldProps {
    label: string
    value: string
    onChange: (next: string) => void
    disabled: boolean
    placeholder?: string
    suggestions?: string[]
}

function TextField({ label, value, onChange, disabled, placeholder, suggestions }: TextFieldProps) {
    const id = `event-field-${label.toLowerCase()}`
    return (
        <div className="flex flex-col gap-1">
            <label htmlFor={id} className="text-sm font-semibold theme-text">{label}</label>
            <input
                id={id}
                value={value}
                disabled={disabled}
                maxLength={MAX_TEXT}
                placeholder={placeholder}
                list={suggestions ? `${id}-options` : undefined}
                onChange={e => onChange(e.target.value)}
                // 16px keeps iOS Safari from zooming the page when the field is focused.
                className={`${inputClass} text-base sm:text-sm`}
            />
            {suggestions && (
                <datalist id={`${id}-options`}>
                    {suggestions.map(s => <option key={s} value={s} />)}
                </datalist>
            )}
        </div>
    )
}
