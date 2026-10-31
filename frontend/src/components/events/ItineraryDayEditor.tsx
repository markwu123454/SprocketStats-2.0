import { useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import type { ItineraryItem } from "@/lib/eventApi"
import Button from "@/components/ui/Button"
import FormFooter from "@/components/ui/FormFooter"
import Notice from "@/components/ui/Notice"
import { useDiscardGuard, useIsDirty } from "@/lib/useDiscardGuard"
import { fieldLabelClass, inputClass } from "@/lib/uiClasses"
import { MAX_LONG_TEXT, MAX_SHORT_TEXT, timeOf, type ItineraryRowDraft } from "@/lib/eventContent"


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
    const confirmDiscard = useDiscardGuard(useIsDirty({ dateValue, rows }))

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
                    <label htmlFor="new-itinerary-day" className={fieldLabelClass}>Date</label>
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
                        <Button
                            variant="icon"
                            aria-label="Remove item"
                            onClick={() => removeRow(i)}
                            className="shrink-0 self-end sm:self-center"
                        >
                            <Trash2 size={16} />
                        </Button>
                    </div>
                ))}
            </div>

            <Button variant="outlined" className="self-start" onClick={addRow}>
                <Plus size={15} />
                Add item
            </Button>

            {error && <Notice>{error}</Notice>}

            <FormFooter className="-mx-4 -mb-3 rounded-b-xl">
                {onDelete && (
                    <Button variant="danger" size="footer" className="mr-auto" onClick={onDelete} disabled={saving}>
                        Delete day
                    </Button>
                )}
                <Button variant="text" size="footer" className="ml-auto" onClick={() => void confirmDiscard().then(ok => { if (ok) onCancel() })} disabled={saving}>
                    Cancel
                </Button>
                <Button size="footer" onClick={() => onSave(dateValue, rows)} disabled={saving}>
                    {saving ? "Saving…" : "Save"}
                </Button>
            </FormFooter>
        </div>
    )
}
