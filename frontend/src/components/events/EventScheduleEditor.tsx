import { useState } from "react"
import Checkbox from "@/components/ui/Checkbox"
import { HIDEABLE_TABS, type EventEntry, type HubTab } from "@/lib/events"
import { patchEventSchedule, type EventSchedulePatch } from "@/lib/eventApi"
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

interface EventScheduleEditorProps {
    event: EventEntry & { id: number }
    onSaved: (updated: EventEntry) => void
    onCancel: () => void
}

export default function EventScheduleEditor({ event, onSaved, onCancel }: EventScheduleEditorProps) {
    const [start, setStart] = useState(() => splitMoment(event.start))
    const [end, setEnd] = useState(() => splitMoment(event.end))
    const [checkin, setCheckin] = useState(() => splitMoment(event.checkinOpens))
    const [hidden, setHidden] = useState<HubTab[]>(event.hiddenTabs ?? [])
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const hasHub = !!(event.tbaKey || event.url)

    function toggleTab(tab: HubTab) {
        setHidden(prev => prev.includes(tab) ? prev.filter(t => t !== tab) : [...prev, tab])
    }

    async function handleSave() {
        const nextStart = joinMoment(start)
        if (!nextStart) { setError("Start date is required."); return }

        // Only send what changed, compared against the same normalization
        // the inputs apply (so an untouched "09:00:00" isn't a change).
        const patch: EventSchedulePatch = {}
        if (nextStart !== joinMoment(splitMoment(event.start))) patch.start = nextStart
        const nextEnd = joinMoment(end)
        if (nextEnd !== joinMoment(splitMoment(event.end))) patch.end = nextEnd
        const nextCheckin = joinMoment(checkin)
        if (nextCheckin !== joinMoment(splitMoment(event.checkinOpens))) patch.checkin_opens = nextCheckin
        const nextHidden = HIDEABLE_TABS.filter(t => hidden.includes(t))
        const prevHidden = HIDEABLE_TABS.filter(t => event.hiddenTabs?.includes(t))
        if (nextHidden.join() !== prevHidden.join()) patch.hidden_tabs = nextHidden

        if (Object.keys(patch).length === 0) { onCancel(); return }

        setSaving(true)
        setError(null)
        try {
            onSaved(await patchEventSchedule(event.id, patch))
        } catch (e) {
            setError(saveErrorMessage(e, "Couldn't save this event. Try again."))
            setSaving(false)
        }
    }

    return (
        <div className="flex flex-col gap-4">
            <p className="text-sm font-semibold theme-text truncate">Edit {event.name}</p>

            {error && (
                <p
                    role="alert"
                    className="text-xs rounded-lg px-3 py-2"
                    style={{ color: DANGER_RED, background: tintColor(DANGER_RED, 10), border: `1px solid ${tintColor(DANGER_RED, 40)}` }}
                >
                    {error}
                </p>
            )}

            <MomentField label="Starts" value={start} onChange={setStart} disabled={saving} />
            <MomentField label="Ends" hint="Leave empty for a single-day event." value={end} onChange={setEnd} disabled={saving} clearable />
            <MomentField
                label="Check-in opens"
                hint="Leave empty to open check-in when the event starts."
                value={checkin}
                onChange={setCheckin}
                disabled={saving}
                clearable
            />

            {hasHub && (
                <fieldset className="flex flex-col gap-2">
                    <legend className="text-sm font-semibold theme-text mb-1">Event pages</legend>
                    <p className="text-xs theme-subtext-color -mt-1">Unchecked pages are hidden from this event. Overview always shows.</p>
                    <div className="flex flex-wrap gap-x-5 gap-y-2">
                        {HIDEABLE_TABS.map(tab => (
                            <label key={tab} className="inline-flex items-center gap-2 min-h-11 text-sm theme-text cursor-pointer">
                                <Checkbox checked={!hidden.includes(tab)} onChange={() => toggleTab(tab)} />
                                {TAB_LABEL[tab]}
                            </label>
                        ))}
                    </div>
                </fieldset>
            )}

            <div className="flex items-center gap-3">
                <button type="button" onClick={() => void handleSave()} disabled={saving} className={primaryButtonClass}>
                    {saving ? "Saving…" : "Save"}
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
