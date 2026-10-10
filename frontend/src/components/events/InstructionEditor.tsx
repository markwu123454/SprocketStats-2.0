import { useState } from "react"
import { DANGER_RED, tintColor } from "@/lib/taskFormat"
import { MAX_LONG_TEXT, MAX_SHORT_TEXT } from "@/lib/eventContent"

const inputClass = "rounded-lg border theme-border theme-bg theme-text px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--theme-text-contrast)]"

interface Props {
    /** The heading being edited, or "" for a brand-new instruction not yet saved. */
    heading: string
    body: string
    saving: boolean
    error: string | null
    onCancel: () => void
    onSave: (heading: string, body: string) => void
    /** Omitted for a brand-new instruction — there's nothing to delete yet. */
    onDelete?: () => void
}

/**
 * In-place editor for one instruction block, swapped in for its read-only
 * heading + body. Owns its own draft state and only hands it to the caller
 * on Save.
 */
export default function InstructionEditor({ heading, body, saving, error, onCancel, onSave, onDelete }: Props) {
    const [headingValue, setHeadingValue] = useState(heading)
    const [bodyValue, setBodyValue] = useState(body)

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
                <label htmlFor={`instruction-heading-${heading || "new"}`} className="text-sm font-semibold theme-text">Heading</label>
                <input
                    id={`instruction-heading-${heading || "new"}`}
                    type="text"
                    value={headingValue}
                    maxLength={MAX_SHORT_TEXT}
                    onChange={e => setHeadingValue(e.target.value)}
                    className={inputClass}
                />
            </div>

            <div className="flex flex-col gap-1">
                <label htmlFor={`instruction-body-${heading || "new"}`} className="text-sm font-semibold theme-text">Body</label>
                <textarea
                    id={`instruction-body-${heading || "new"}`}
                    value={bodyValue}
                    maxLength={MAX_LONG_TEXT}
                    onChange={e => setBodyValue(e.target.value)}
                    rows={4}
                    className={`${inputClass} resize-y`}
                />
            </div>

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
                        Delete
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
                        onClick={() => onSave(headingValue, bodyValue)}
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
