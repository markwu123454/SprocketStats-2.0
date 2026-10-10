import { useId } from "react"
import { Check } from "lucide-react"
import { eventDayLabel } from "@/lib/events"
import { DANGER_RED } from "@/lib/taskFormat"

interface DayChipsProps {
    /** Field label, e.g. "Days you'll be there" or "Your days". */
    label: string
    /** The event's own day list, in order -- one chip per entry. */
    days: string[]
    selected: string[]
    onToggle: (day: string) => void
    disabled?: boolean
    /** "Pick at least one day." when present; cleared by the caller on toggle. */
    error?: string | null
}

// Shared between the dashboard's check-in form (ActiveEventCard) and the
// roster's per-member day editor (RosterPage) so both offer the exact same
// control rather than two hand-rolled pickers that could drift apart.
export default function DayChips({ label, days, selected, onToggle, disabled, error }: DayChipsProps) {
    const labelId = useId()

    return (
        <div className="flex flex-col gap-1" role="group" aria-labelledby={labelId}>
            <label id={labelId} className="text-sm font-semibold theme-text">{label}</label>
            <div className="flex flex-wrap gap-2">
                {days.map(day => {
                    const isSelected = selected.includes(day)
                    return (
                        <button
                            key={day}
                            type="button"
                            aria-pressed={isSelected}
                            disabled={disabled}
                            onClick={() => onToggle(day)}
                            className="inline-flex items-center gap-1.5 rounded-full border text-sm min-h-11 px-3.5 outline-none focus:ring-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{
                                borderColor: isSelected ? "var(--theme-text-contrast)" : "var(--theme-border)",
                                color: isSelected ? "var(--theme-text-contrast)" : "var(--theme-subtext-color)",
                                background: isSelected
                                    ? "color-mix(in oklch, var(--theme-text-contrast) 12%, transparent)"
                                    : "transparent",
                            }}
                        >
                            {isSelected && <Check size={14} />}
                            {eventDayLabel(day)}
                        </button>
                    )
                })}
            </div>
            {error && (
                <p role="alert" className="text-xs" style={{ color: DANGER_RED }}>{error}</p>
            )}
        </div>
    )
}
