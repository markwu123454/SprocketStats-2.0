import { useEffect, useRef, useState, forwardRef } from "react"
import type { ReactNode } from "react"
import { Pencil, Plus } from "lucide-react"
import { useEventContext } from "@/contexts/eventContext"
import { useOnboardedUser } from "@/contexts/authContext"
import { can } from "@/lib/permissions"
import { patchEventContent, type ItineraryItem } from "@/lib/eventApi"
import {
    buildDt,
    currentItineraryIndex,
    dayKey,
    replaceDay,
    saveErrorMessage,
    validateItineraryDay,
    type ItineraryRowDraft,
} from "@/lib/eventContent"
import ItineraryDayEditor from "@/components/events/ItineraryDayEditor"
import { DANGER_RED, tintColor } from "@/lib/taskFormat"
import Button from "@/components/ui/Button"
import { confirmDialog } from "@/lib/confirmDialog"
import { typeH2 } from "@/lib/uiClasses"

// Sentinel `editingDay` value for "adding a brand-new day" (distinct from
// `null`, which means nothing is being edited).
const NEW_DAY = "__new__"

function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

type Row =
    | { type: "day";  label: string; day: string }
    | { type: "item"; item: ItineraryItem; isPast: boolean; isCurrent: boolean }

// `currentIndex` (from `currentItineraryIndex`) is an index into `items`,
// not into the returned rows — it's looked up by position as we walk the
// same array. The current item is never dimmed as "past" even though its
// `dt` has, by definition, already happened.
function buildRows(items: ItineraryItem[], now: number, currentIndex: number): Row[] {
    const rows: Row[] = []
    let currentDay = ""

    for (let i = 0; i < items.length; i++) {
        const item      = items[i]
        const isCurrent = i === currentIndex
        const isPast    = !isCurrent && new Date(item.dt).getTime() <= now
        const dayLabel = new Date(item.dt).toLocaleDateString("en-US", {
            weekday: "long", month: "long", day: "numeric",
        })

        if (dayLabel !== currentDay) {
            currentDay = dayLabel
            rows.push({ type: "day", label: dayLabel, day: dayKey(item.dt) })
        }

        rows.push({ type: "item", item, isPast, isCurrent })
    }

    return rows
}

export default function ItineraryPage() {
    const { eventKey, info, loading, updateInfo } = useEventContext()
    const user = useOnboardedUser()
    const isEditor = can(user.permissions, "events.edit")
    const currentItemRef = useRef<HTMLDivElement>(null)

    // Only one day (including "add a new day") is ever in edit mode at once.
    const [editingDay, setEditingDay] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [saveError, setSaveError] = useState<string | null>(null)

    useEffect(() => {
        if (currentItemRef.current) {
            currentItemRef.current.scrollIntoView({ behavior: "smooth", block: "center" })
        }
    }, [loading])

    function startEdit(day: string) {
        setSaveError(null)
        setEditingDay(day)
    }

    function stopEdit() {
        setSaveError(null)
        setEditingDay(null)
    }

    // `originalDay` is the day key the edited rows used to live under (null
    // for a brand-new day); `newDay` is whatever the editor is currently
    // showing (equal to `originalDay` unless this is a new day). Reading
    // `info` here rather than from a value captured when the editor opened
    // means the save is always based on the latest known itinerary, so an
    // edit to one day can't clobber a concurrent edit to another.
    async function handleSaveDay(originalDay: string | null, newDay: string, rows: ItineraryRowDraft[]) {
        const err = validateItineraryDay(newDay, rows)
        if (err) { setSaveError(err); return }

        const current = info?.itinerary ?? []
        if (originalDay === null && current.some(it => dayKey(it.dt) === newDay)) {
            setSaveError("This day already has an itinerary — edit it instead of adding it again.")
            return
        }

        const builtItems: ItineraryItem[] = rows.map(row => ({
            dt: buildDt(newDay, row.time),
            label: row.label.trim(),
            detail: row.detail.trim() ? row.detail.trim() : null,
        }))

        setSaving(true)
        setSaveError(null)
        try {
            const dayToReplace = originalDay ?? newDay
            const updated = replaceDay(current, dayToReplace, builtItems)
            const result = await patchEventContent(eventKey, { itinerary: updated })
            updateInfo({ itinerary: result.itinerary })
            setEditingDay(null)
        } catch (e) {
            setSaveError(saveErrorMessage(e, "Couldn't save the itinerary. Try again."))
        } finally {
            setSaving(false)
        }
    }

    async function handleDeleteDay(day: string) {
        if (!await confirmDialog({ title: "Delete this day's itinerary?", body: "This can't be undone.", confirmLabel: "Delete", danger: true })) return
        setSaving(true)
        setSaveError(null)
        try {
            const current = info?.itinerary ?? []
            const updated = replaceDay(current, day, [])
            const result = await patchEventContent(eventKey, { itinerary: updated })
            updateInfo({ itinerary: result.itinerary })
            setEditingDay(null)
        } catch (e) {
            setSaveError(saveErrorMessage(e, "Couldn't delete this day. Try again."))
        } finally {
            setSaving(false)
        }
    }

    const itinerary = info?.itinerary ?? []
    const currentIndex = itinerary.length > 0 ? currentItineraryIndex(itinerary, new Date()) : -1
    const rows = itinerary.length > 0 ? buildRows(itinerary, Date.now(), currentIndex) : []

    const elements: ReactNode[] = []
    let currentRenderedDay = ""
    rows.forEach((row, i) => {
        if (row.type === "day") {
            currentRenderedDay = row.day
            elements.push(
                <DayHeader
                    key={`h-${i}`}
                    label={row.label}
                    day={row.day}
                    showPencil={isEditor && editingDay === null}
                    onEdit={startEdit}
                />,
            )
            if (editingDay === row.day) {
                elements.push(
                    <ItineraryDayEditor
                        key={`e-${i}`}
                        day={row.day}
                        items={(info?.itinerary ?? []).filter(it => dayKey(it.dt) === row.day)}
                        saving={saving}
                        error={saveError}
                        onCancel={stopEdit}
                        onSave={(newDay, draftRows) => void handleSaveDay(row.day, newDay, draftRows)}
                        onDelete={() => void handleDeleteDay(row.day)}
                    />,
                )
            }
            return
        }
        if (currentRenderedDay === editingDay) return // this day's rows are replaced by its editor above
        elements.push(
            <ItemRow
                key={i}
                item={row.item}
                isPast={row.isPast}
                isCurrent={row.isCurrent}
                ref={row.isCurrent ? currentItemRef : undefined}
            />,
        )
    })

    return (
        <div className="max-w-xl mx-auto px-4 py-6 flex flex-col gap-3">
            <div
                className="rounded-xl border"
                style={{ background: "var(--theme-bg)", borderColor: "var(--theme-border)" }}
            >
                {rows.length > 0 ? (
                    elements
                ) : (
                    <div className="px-4 py-3 text-sm" style={{ color: "var(--theme-subtext-color)" }}>
                        Itinerary not yet posted.
                    </div>
                )}
            </div>

            {isEditor && editingDay === null && (
                <Button variant="outlined" className="self-start" onClick={() => startEdit(NEW_DAY)}>
                    <Plus size={15} />
                    Add day
                </Button>
            )}

            {isEditor && editingDay === NEW_DAY && (
                <div
                    className="rounded-xl border"
                    style={{ background: "var(--theme-bg)", borderColor: "var(--theme-border)" }}
                >
                    <ItineraryDayEditor
                        day=""
                        items={[]}
                        saving={saving}
                        error={saveError}
                        onCancel={stopEdit}
                        onSave={(newDay, draftRows) => void handleSaveDay(null, newDay, draftRows)}
                    />
                </div>
            )}
        </div>
    )
}

function DayHeader({ label, day, showPencil, onEdit }: { label: string; day: string; showPencil: boolean; onEdit: (day: string) => void }) {
    return (
        <div
            className="px-4 py-2.5 border-b flex items-center justify-between gap-2"
            style={{
                borderColor: "var(--theme-border)",
                background: "color-mix(in oklch, var(--theme-bg) 60%, var(--theme-border))",
            }}
        >
            <span className={`${typeH2} theme-subtext-color`}>
                {label}
            </span>
            {showPencil && (
                <Button
                    variant="icon"
                    aria-label={`Edit ${label}`}
                    onClick={() => onEdit(day)}
                    className="-my-2 -mr-2.5 shrink-0"
                >
                    <Pencil size={14} />
                </Button>
            )}
        </div>
    )
}

const ItemRow = forwardRef<HTMLDivElement, { item: ItineraryItem; isPast: boolean; isCurrent: boolean }>(
    function ItemRow({ item, isPast, isCurrent }, ref) {
        return (
            <div
                ref={ref}
                className="flex items-start gap-3 px-4 py-3 border-b last:border-0 transition-opacity"
                style={{
                    borderColor: "var(--theme-border)",
                    background: isCurrent ? tintColor(DANGER_RED, 10) : undefined,
                    opacity: isPast ? 0.4 : 1,
                }}
            >
                <span
                    className="text-sm font-mono w-16 shrink-0 pt-0.5"
                    style={{ color: isCurrent ? DANGER_RED : "var(--theme-subtext-color)" }}
                >
                    {formatTime(item.dt)}
                </span>
                <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-sm font-medium" style={{ color: isCurrent ? DANGER_RED : "var(--theme-text)" }}>
                        {item.label}
                    </span>
                    {item.detail && (
                        <span className="text-xs" style={{ color: "var(--theme-subtext-color)" }}>
                            {item.detail}
                        </span>
                    )}
                </div>
                {isCurrent && (
                    <span
                        className={`ml-auto shrink-0 ${typeH2}`}
                        style={{ color: DANGER_RED }}
                    >
                        Now
                    </span>
                )}
            </div>
        )
    },
)
