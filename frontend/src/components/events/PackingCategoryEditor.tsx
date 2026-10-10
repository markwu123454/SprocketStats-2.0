import { useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { DANGER_RED, tintColor } from "@/lib/taskFormat"
import { MAX_PACKING_ITEM, MAX_SHORT_TEXT } from "@/lib/eventContent"

const inputClass = "rounded-lg border theme-border theme-bg theme-text px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--theme-text-contrast)]"
const addButtonClass = "inline-flex items-center gap-1.5 self-start rounded-lg border theme-border theme-bg theme-text-contrast text-sm font-semibold px-3 py-2 min-h-11 hover:opacity-90 transition-opacity outline-none focus:ring-2 focus:ring-[var(--theme-text-contrast)]"

interface Props {
    /** The category name being edited, or "" for a brand-new category not yet saved. */
    category: string
    items: string[]
    saving: boolean
    error: string | null
    onCancel: () => void
    onSave: (category: string, items: string[]) => void
    /** Omitted for a brand-new category — there's nothing to delete yet. */
    onDelete?: () => void
}

/**
 * In-place editor for one packing-list category, swapped in for that
 * category's checkbox list. Owns its own draft state and only hands it to
 * the caller on Save.
 */
export default function PackingCategoryEditor({ category, items, saving, error, onCancel, onSave, onDelete }: Props) {
    const [name, setName] = useState(category)
    const [draftItems, setDraftItems] = useState<string[]>(() => (items.length > 0 ? items : [""]))

    function updateItem(i: number, value: string) {
        setDraftItems(prev => prev.map((item, idx) => (idx === i ? value : item)))
    }

    function addItem() {
        setDraftItems(prev => [...prev, ""])
    }

    function removeItem(i: number) {
        setDraftItems(prev => prev.filter((_, idx) => idx !== i))
    }

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
                <label htmlFor={`category-name-${category || "new"}`} className="text-sm font-semibold theme-text">Category name</label>
                <input
                    id={`category-name-${category || "new"}`}
                    type="text"
                    value={name}
                    maxLength={MAX_SHORT_TEXT}
                    onChange={e => setName(e.target.value)}
                    className={inputClass}
                />
            </div>

            <div className="flex flex-col gap-2">
                {draftItems.map((item, i) => (
                    <div key={i} className="flex items-center gap-2">
                        <input
                            type="text"
                            aria-label="Packing item"
                            placeholder="Item"
                            value={item}
                            maxLength={MAX_PACKING_ITEM}
                            onChange={e => updateItem(i, e.target.value)}
                            className={`${inputClass} flex-1 min-w-0`}
                        />
                        <button
                            type="button"
                            aria-label="Remove item"
                            onClick={() => removeItem(i)}
                            className="inline-flex items-center justify-center w-9 h-9 shrink-0 opacity-50 hover:opacity-100 transition-opacity rounded-lg outline-none focus:ring-2 focus:ring-[var(--theme-text-contrast)]"
                        >
                            <Trash2 size={16} className="theme-text" />
                        </button>
                    </div>
                ))}
            </div>

            <button type="button" onClick={addItem} className={addButtonClass}>
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
                        Delete category
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
                        onClick={() => onSave(name, draftItems)}
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
