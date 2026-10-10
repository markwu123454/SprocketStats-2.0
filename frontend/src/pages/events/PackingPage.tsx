import { useState } from "react"
import { Pencil, Plus } from "lucide-react"
import { useEventContext } from "@/contexts/eventContext"
import { useOnboardedUser } from "@/contexts/authContext"
import { can } from "@/lib/permissions"
import { patchEventContent, type Instruction, type PackingCategory } from "@/lib/eventApi"
import { cleanStrings, saveErrorMessage, validateInstruction, validatePackingCategory } from "@/lib/eventContent"
import PackingCategoryEditor from "@/components/events/PackingCategoryEditor"
import InstructionEditor from "@/components/events/InstructionEditor"

const addButtonClass = "inline-flex items-center gap-1.5 self-start rounded-lg border theme-border theme-bg theme-text-contrast text-sm font-semibold px-3 py-2 min-h-11 hover:opacity-90 transition-opacity outline-none focus:ring-2 focus:ring-[var(--theme-text-contrast)]"
const cardStyle = { background: "var(--theme-bg)", borderColor: "var(--theme-border)" }

// Only one thing on the page — a category or an instruction, existing or
// brand-new — is ever in edit mode at once.
type Editing =
    | { kind: "category"; name: string | null }
    | { kind: "instruction"; index: number | null }
    | null

export default function PackingPage() {
    const { eventKey, info, updateInfo } = useEventContext()
    const user = useOnboardedUser()
    const isEditor = can(user.permissions, "events.edit")
    const [checked, setChecked] = useState<Set<string>>(new Set())

    const [editing, setEditing] = useState<Editing>(null)
    const [saving, setSaving] = useState(false)
    const [saveError, setSaveError] = useState<string | null>(null)

    const hasPacking      = (info?.packing_list?.length ?? 0) > 0
    const hasInstructions = (info?.instructions?.length ?? 0) > 0

    function toggle(id: string) {
        setChecked(prev => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    function stopEditing() {
        setSaveError(null)
        setEditing(null)
    }

    // Reads `info` fresh at save time (not a value captured when the editor
    // opened) so this save is always layered on the latest known content —
    // an edit to one category can't clobber a concurrent edit to another.
    async function handleSaveCategory(originalName: string | null, newName: string, items: string[]) {
        const current = info?.packing_list ?? []
        const others = current.filter(c => c.category !== originalName).map(c => c.category)
        const err = validatePackingCategory(newName, items, others)
        if (err) { setSaveError(err); return }

        const cleanedItems = cleanStrings(items)
        const trimmedName = newName.trim()
        const updated: PackingCategory[] = originalName === null
            ? [...current, { category: trimmedName, items: cleanedItems }]
            : current.map(c => (c.category === originalName ? { category: trimmedName, items: cleanedItems } : c))

        setSaving(true)
        setSaveError(null)
        try {
            const result = await patchEventContent(eventKey, { packing_list: updated })
            updateInfo({ packing_list: result.packing_list })
            setEditing(null)
        } catch (e) {
            setSaveError(saveErrorMessage(e, "Couldn't save the packing list. Try again."))
        } finally {
            setSaving(false)
        }
    }

    async function handleDeleteCategory(name: string) {
        if (!window.confirm(`Delete the "${name}" category? This can't be undone.`)) return
        setSaving(true)
        setSaveError(null)
        try {
            const current = info?.packing_list ?? []
            const updated = current.filter(c => c.category !== name)
            const result = await patchEventContent(eventKey, { packing_list: updated })
            updateInfo({ packing_list: result.packing_list })
            setEditing(null)
        } catch (e) {
            setSaveError(saveErrorMessage(e, "Couldn't delete this category. Try again."))
        } finally {
            setSaving(false)
        }
    }

    async function handleSaveInstruction(originalIndex: number | null, heading: string, body: string) {
        const err = validateInstruction(heading, body)
        if (err) { setSaveError(err); return }

        const current = info?.instructions ?? []
        const entry: Instruction = { heading: heading.trim(), body: body.trim() }
        const updated: Instruction[] = originalIndex === null
            ? [...current, entry]
            : current.map((instr, i) => (i === originalIndex ? entry : instr))

        setSaving(true)
        setSaveError(null)
        try {
            const result = await patchEventContent(eventKey, { instructions: updated })
            updateInfo({ instructions: result.instructions })
            setEditing(null)
        } catch (e) {
            setSaveError(saveErrorMessage(e, "Couldn't save the instructions. Try again."))
        } finally {
            setSaving(false)
        }
    }

    async function handleDeleteInstruction(index: number) {
        if (!window.confirm("Delete this instruction? This can't be undone.")) return
        setSaving(true)
        setSaveError(null)
        try {
            const current = info?.instructions ?? []
            const updated = current.filter((_, i) => i !== index)
            const result = await patchEventContent(eventKey, { instructions: updated })
            updateInfo({ instructions: result.instructions })
            setEditing(null)
        } catch (e) {
            setSaveError(saveErrorMessage(e, "Couldn't delete this instruction. Try again."))
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="max-w-xl mx-auto px-4 py-6 flex flex-col gap-8">

            {/* Packing list */}
            <section className="flex flex-col gap-3">
                <h2
                    className="text-[11px] font-bold tracking-wider uppercase"
                    style={{ color: "var(--theme-subtext-color)" }}
                >
                    Packing List
                </h2>
                {hasPacking ? (
                    <div className="flex flex-col gap-3">
                        {info!.packing_list!.map(({ category, items }) => {
                            const isEditingThis = editing?.kind === "category" && editing.name === category
                            return (
                                <div
                                    key={category}
                                    className="rounded-xl border px-4 py-3"
                                    style={cardStyle}
                                >
                                    {isEditingThis ? (
                                        <PackingCategoryEditor
                                            category={category}
                                            items={items}
                                            saving={saving}
                                            error={saveError}
                                            onCancel={stopEditing}
                                            onSave={(name, newItems) => void handleSaveCategory(category, name, newItems)}
                                            onDelete={() => void handleDeleteCategory(category)}
                                        />
                                    ) : (
                                        <>
                                            <div className="flex items-center justify-between gap-2 mb-3">
                                                <h3 className="text-sm font-semibold" style={{ color: "var(--theme-text)" }}>
                                                    {category}
                                                </h3>
                                                {isEditor && editing === null && (
                                                    <button
                                                        type="button"
                                                        aria-label={`Edit ${category}`}
                                                        onClick={() => setEditing({ kind: "category", name: category })}
                                                        className="inline-flex items-center justify-center w-9 h-9 -my-1.5 -mr-1.5 shrink-0 opacity-50 hover:opacity-100 transition-opacity rounded-lg outline-none focus:ring-2 focus:ring-[var(--theme-text-contrast)]"
                                                    >
                                                        <Pencil size={14} className="theme-subtext-color" />
                                                    </button>
                                                )}
                                            </div>
                                            <div className="flex flex-col gap-2">
                                                {items.map(item => {
                                                    const id   = `${category}:${item}`
                                                    const done = checked.has(id)
                                                    return (
                                                        <label key={id} className="flex items-center gap-2.5 cursor-pointer">
                                                            <input type="checkbox" checked={done} onChange={() => toggle(id)} className="sr-only" />
                                                            <div
                                                                className="w-4 h-4 rounded border shrink-0 flex items-center justify-center transition-colors"
                                                                style={{
                                                                    background:  done ? "var(--theme-text-contrast)" : "var(--theme-bg)",
                                                                    borderColor: done ? "var(--theme-text-contrast)" : "var(--theme-border)",
                                                                }}
                                                            >
                                                                {done && (
                                                                    <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                                                                        <path d="M1 4l2.5 2.5L9 1" stroke="var(--theme-bg)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                                                    </svg>
                                                                )}
                                                            </div>
                                                            <span
                                                                className="text-sm transition-opacity"
                                                                style={{
                                                                    color:          done ? "var(--theme-subtext-color)" : "var(--theme-text)",
                                                                    opacity:        done ? 0.5 : 1,
                                                                    textDecoration: done ? "line-through" : "none",
                                                                }}
                                                            >
                                                                {item}
                                                            </span>
                                                        </label>
                                                    )
                                                })}
                                            </div>
                                        </>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                ) : (
                    <div
                        className="rounded-xl border px-4 py-3 text-sm"
                        style={{ ...cardStyle, color: "var(--theme-subtext-color)" }}
                    >
                        Packing list not yet posted.
                    </div>
                )}

                {isEditor && editing === null && (
                    <button type="button" onClick={() => setEditing({ kind: "category", name: null })} className={addButtonClass}>
                        <Plus size={15} />
                        Add category
                    </button>
                )}

                {isEditor && editing?.kind === "category" && editing.name === null && (
                    <div className="rounded-xl border px-4 py-3" style={cardStyle}>
                        <PackingCategoryEditor
                            category=""
                            items={[]}
                            saving={saving}
                            error={saveError}
                            onCancel={stopEditing}
                            onSave={(name, newItems) => void handleSaveCategory(null, name, newItems)}
                        />
                    </div>
                )}
            </section>

            {/* Instructions */}
            <section className="flex flex-col gap-3">
                <h2
                    className="text-[11px] font-bold tracking-wider uppercase"
                    style={{ color: "var(--theme-subtext-color)" }}
                >
                    Instructions
                </h2>
                {hasInstructions ? (
                    <div className="flex flex-col gap-4">
                        {info!.instructions!.map((instr, idx) => {
                            const isEditingThis = editing?.kind === "instruction" && editing.index === idx
                            return (
                                <div key={idx}>
                                    {isEditingThis ? (
                                        <InstructionEditor
                                            heading={instr.heading}
                                            body={instr.body}
                                            saving={saving}
                                            error={saveError}
                                            onCancel={stopEditing}
                                            onSave={(h, b) => void handleSaveInstruction(idx, h, b)}
                                            onDelete={() => void handleDeleteInstruction(idx)}
                                        />
                                    ) : (
                                        <>
                                            <div className="flex items-center justify-between gap-2 mb-1">
                                                <h3 className="text-sm font-semibold" style={{ color: "var(--theme-text)" }}>
                                                    {instr.heading}
                                                </h3>
                                                {isEditor && editing === null && (
                                                    <button
                                                        type="button"
                                                        aria-label={`Edit ${instr.heading}`}
                                                        onClick={() => setEditing({ kind: "instruction", index: idx })}
                                                        className="inline-flex items-center justify-center w-9 h-9 -my-1.5 -mr-1.5 shrink-0 opacity-50 hover:opacity-100 transition-opacity rounded-lg outline-none focus:ring-2 focus:ring-[var(--theme-text-contrast)]"
                                                    >
                                                        <Pencil size={14} className="theme-subtext-color" />
                                                    </button>
                                                )}
                                            </div>
                                            <p className="text-sm leading-relaxed" style={{ color: "var(--theme-subtext-color)" }}>
                                                {instr.body}
                                            </p>
                                        </>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                ) : (
                    <div
                        className="rounded-xl border px-4 py-3 text-sm"
                        style={{ ...cardStyle, color: "var(--theme-subtext-color)" }}
                    >
                        Instructions not yet posted.
                    </div>
                )}

                {isEditor && editing === null && (
                    <button type="button" onClick={() => setEditing({ kind: "instruction", index: null })} className={addButtonClass}>
                        <Plus size={15} />
                        Add instruction
                    </button>
                )}

                {isEditor && editing?.kind === "instruction" && editing.index === null && (
                    <InstructionEditor
                        heading=""
                        body=""
                        saving={saving}
                        error={saveError}
                        onCancel={stopEditing}
                        onSave={(h, b) => void handleSaveInstruction(null, h, b)}
                    />
                )}
            </section>
        </div>
    )
}
