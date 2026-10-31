import { useState } from "react"
import Button from "@/components/ui/Button"
import FormFooter from "@/components/ui/FormFooter"
import Notice from "@/components/ui/Notice"
import { useDiscardGuard, useIsDirty } from "@/lib/useDiscardGuard"
import { fieldLabelClass, inputClass } from "@/lib/uiClasses"
import { MAX_LONG_TEXT, MAX_SHORT_TEXT } from "@/lib/eventContent"


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
    const confirmDiscard = useDiscardGuard(useIsDirty({ headingValue, bodyValue }))

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
                <label htmlFor={`instruction-heading-${heading || "new"}`} className={fieldLabelClass}>Heading</label>
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
                <label htmlFor={`instruction-body-${heading || "new"}`} className={fieldLabelClass}>Body</label>
                <textarea
                    id={`instruction-body-${heading || "new"}`}
                    value={bodyValue}
                    maxLength={MAX_LONG_TEXT}
                    onChange={e => setBodyValue(e.target.value)}
                    rows={4}
                    className={`${inputClass} resize-y`}
                />
            </div>

            {error && <Notice>{error}</Notice>}

            <FormFooter className="-mx-4 -mb-3 rounded-b-xl">
                {onDelete && (
                    <Button variant="danger" size="footer" className="mr-auto" onClick={onDelete} disabled={saving}>
                        Delete
                    </Button>
                )}
                <Button variant="text" size="footer" className="ml-auto" onClick={() => void confirmDiscard().then(ok => { if (ok) onCancel() })} disabled={saving}>
                    Cancel
                </Button>
                <Button size="footer" onClick={() => onSave(headingValue, bodyValue)} disabled={saving}>
                    {saving ? "Saving…" : "Save"}
                </Button>
            </FormFooter>
        </div>
    )
}
