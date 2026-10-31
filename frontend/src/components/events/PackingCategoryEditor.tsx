import { useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import Button from "@/components/ui/Button"
import FormFooter from "@/components/ui/FormFooter"
import Notice from "@/components/ui/Notice"
import { useDiscardGuard, useIsDirty } from "@/lib/useDiscardGuard"
import { fieldLabelClass, inputClass } from "@/lib/uiClasses"
import { MAX_PACKING_ITEM, MAX_SHORT_TEXT } from "@/lib/eventContent"


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
    const confirmDiscard = useDiscardGuard(useIsDirty({ name, draftItems }))

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
                <label htmlFor={`category-name-${category || "new"}`} className={fieldLabelClass}>Category name</label>
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
                        <Button
                            variant="icon"
                            aria-label="Remove item"
                            onClick={() => removeItem(i)}
                            className="shrink-0"
                        >
                            <Trash2 size={16} />
                        </Button>
                    </div>
                ))}
            </div>

            <Button variant="outlined" className="self-start" onClick={addItem}>
                <Plus size={15} />
                Add item
            </Button>

            {error && <Notice>{error}</Notice>}

            <FormFooter className="-mx-4 -mb-3 rounded-b-xl">
                {onDelete && (
                    <Button variant="danger" size="footer" className="mr-auto" onClick={onDelete} disabled={saving}>
                        Delete category
                    </Button>
                )}
                <Button variant="text" size="footer" className="ml-auto" onClick={() => void confirmDiscard().then(ok => { if (ok) onCancel() })} disabled={saving}>
                    Cancel
                </Button>
                <Button size="footer" onClick={() => onSave(name, draftItems)} disabled={saving}>
                    {saving ? "Saving…" : "Save"}
                </Button>
            </FormFooter>
        </div>
    )
}
