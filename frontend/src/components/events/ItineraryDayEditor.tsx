import { useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import type { ItineraryItem } from "@/lib/eventApi"
import { DANGER_RED, tintColor } from "@/lib/taskFormat"
import { MAX_LONG_TEXT, MAX_SHORT_TEXT, timeOf, type ItineraryRowDraft } from "@/lib/eventContent"

const inputClass = "rounded-lg border theme-border theme-bg theme-text px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--theme-text-contrast)]"
const addButtonClass = "inline-flex items-center gap-1.5 self-start rounded-lg border theme-border theme-bg theme-text-contrast text-sm font-semibold px-3 py-2 min-h-11 hover:opacity-90 transition-opacity outline-none focus:ring-2 focus:ring-[var(--theme-text-contrast)]"

function todayKey(): string {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function rowsFromItems(items: ItineraryItem[]): ItineraryRowDraft[] {
    return items.length > 0
        ? items.map(i => ({ time: timeOf(i.dt), label: i.label, detail: i.detail ?? "" }))
        : [{ time: "", label: "", detail: "" }]
}

interface Props {
    /** The day being edited ("YYYY-MM-DD"), or "" for a brand-new day not yet saved. */
    day: string
    items: ItineraryItem[]
    saving: boolean
    error: string | null
    onCancel: () => void
    onSave: (day: string, rows: ItineraryRowDraft[]) => void
    /** Omitted for a brand-new day — there's nothing to delete yet. */
    onDelete?: () => void
}

/**
 * In-place editor for one itinerary day, swapped in for that day's read-only
 * rows. Owns its own draft state (date, item rows) and only hands it to the
 * caller on Save; Cancel just unmounts without writing anything back.
 */
export default function ItineraryDayEditor({ day, items, saving, error, onCancel, onSave, onDelete }: Props) {
    const [dateValue, setDateValue] = useState(() => day || todayKey())
    const [rows, setRows] = useState<ItineraryRowDraft[]>(() => rowsFromItems(items))

    function updateRow(i: number, patch: Partial<ItineraryRowDraft>) {
        setRows(prev => prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)))
    }

    function addRow() {
        setRows(prev => [...prev, { time: "", label: "", detail: "" }])
    }

    function removeRow(i: number) {
        setRows(prev => prev.filter((_, idx) => idx !== i))
    }

    return (
        <div className="px-4 py-3 flex flex-col gap-3">
            {!day && (
                <div className="flex flex-col gap-1">
                    <label htmlFor="new-itinerary-day" className="text-sm font-semibold theme-text">Date</label>
                    <input
                        id="new-itinerary-day"
                        type="date"
                        value={dateValue}
                        onChange={e => setDateValue(e.target.value)}
                        className={`${inputClass} self-start`}
                    />
                </div>
            )}

            <div className="flex flex-col gap-2.5">
                {rows.map((row, i) => (
                    <div key={i} className="flex flex-col sm:flex-row gap-2 sm:items-center">
                        <input
                            type="time"
                            aria-label="Time"
                            value={row.time}
                            onChange={e => updateRow(i, { time: e.target.value })}
                            className={`${inputClass} sm:w-32 shrink-0`}
                        />
                        <input
                            type="text"
                            aria-label="Label"
                            placeholder="Label"
                            value={row.label}
                            maxLength={MAX_SHORT_TEXT}
                            onChange={e => updateRow(i, { label: e.target.value })}
                            className={`${inputClass} flex-1 min-w-0`}
                        />
                        <input
                            type="text"
                            aria-label="Detail (optional)"
                            placeholder="Detail (optional)"
                            value={row.detail}
                            maxLength={MAX_LONG_TEXT}
                            onChange={e => updateRow(i, { detail: e.target.value })}
                            className={`${inputClass} flex-1 min-w-0`}
                        />
                        <button
                            type="button"
                            aria-label="Remove item"
                            onClick={() => removeRow(i)}
                            className="inline-flex items-center justify-center w-9 h-9 shrink-0 self-end sm:self-center opacity-50 hover:opacity-100 transition-opacity rounded-lg outline-none focus:ring-2 focus:ring-[var(--theme-text-contrast)]"
                        >
                            <Trash2 size={16} className="theme-text" />
                        </button>
                    </div>
                ))}
            </div>

            <button type="button" onClick={addRow} className={addButtonClass}>
                <Plus size={15} />
                Add item
            </button>

            {error && (
                <p
                    role="alert"
                    className="text-sm rounded-lg border px-3 py-2"
                    style={{ color: DANGER_RED, borderColor: tintColor(DANGER_RED, 40), background: tintColor(DANGER_RED, 10) }}
                >
                    {error}
                </p>
            )}

            <div className="flex items-center justify-between gap-3">
                {onDelete ? (
                    <button
                        type="button"
                        onClick={onDelete}
                        disabled={saving}
                        className="text-sm font-semibold px-3 py-2 min-h-11 rounded-lg hover:opacity-80 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed outline-none focus:ring-2 focus:ring-[var(--theme-text-contrast)]"
                        style={{ color: DANGER_RED }}
                    >
                        Delete day
                    </button>
                ) : <span />}

                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={onCancel}
                        disabled={saving}
                        className="text-sm font-semibold theme-subtext-color px-3 py-2 min-h-11 rounded-lg hover:opacity-80 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed outline-none focus:ring-2 focus:ring-[var(--theme-text-contrast)]"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={() => onSave(dateValue, rows)}
                        disabled={saving}
                        className="rounded-lg border theme-bg theme-border theme-text-contrast text-sm font-semibold px-4 py-2 min-h-11 disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity outline-none focus:ring-2 focus:ring-[var(--theme-text-contrast)]"
                    >
                        {saving ? "Saving…" : "Save"}
                    </button>
                </div>
            </div>
        </div>
    )
}
