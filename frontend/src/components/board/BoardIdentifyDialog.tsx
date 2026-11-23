import { type FormEvent, useId, useRef, useState } from "react"
import { X } from "lucide-react"
import Button from "@/components/ui/Button"
import Dialog from "@/components/ui/Dialog"
import { actWithEmail, boardErrorMessage, type Acting } from "@/lib/boardApi"
import { fieldLabelClass, focusRing, inputClass, typeTitle } from "@/lib/uiClasses"

// Student emails are a 6-digit student number at the school domain, so
// students type just the number (on a number pad) and the server fills in the
// domain. Mentors switch to typing their whole email.
const STUDENT_DOMAIN = "@stu.wvusd.org"
const STUDENT_NUMBER = /^\d{6}$/

/**
 * "Who are you?" for a member who can't show their code (no phone on them, or
 * an app that never downloaded its code). A typed email proves nothing, so it
 * only unlocks self-service changes; the copy says so.
 */
export default function BoardIdentifyDialog({ onActing, onClose }: {
    onActing: (acting: Acting) => void
    onClose: () => void
}) {
    const titleId = useId()
    const inputId = useId()
    const inputRef = useRef<HTMLInputElement>(null)
    const [fullEmail, setFullEmail] = useState(false)
    const [value, setValue] = useState("")
    const [error, setError] = useState<string | null>(null)
    const [sending, setSending] = useState(false)
    const typed = value.trim()

    const switchMode = () => {
        setFullEmail(prev => !prev)
        setValue("")
        setError(null)
        // A new keyboard only shows once the field is focused again.
        inputRef.current?.blur()
        window.setTimeout(() => inputRef.current?.focus(), 0)
    }

    const submit = async (e: FormEvent) => {
        e.preventDefault()
        if (!typed || sending) return
        if (!fullEmail && !STUDENT_NUMBER.test(typed)) {
            setError("Type the 6 digits before @stu.wvusd.org.")
            return
        }
        setSending(true)
        setError(null)
        try {
            onActing(await actWithEmail(fullEmail ? typed : `${typed}${STUDENT_DOMAIN}`))
        } catch (err) {
            setError(boardErrorMessage(err))
            setSending(false)
        }
    }

    return (
        <Dialog labelledBy={titleId} onDismiss={onClose} initialFocus={inputRef} className="max-w-lg">
            <form onSubmit={e => void submit(e)} className="flex flex-col gap-4 p-6">
                <div className="flex items-start justify-between gap-3 -mr-3 -mt-2">
                    <h2 id={titleId} className={`${typeTitle} theme-h1-color pt-2`}>Who are you?</h2>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close"
                        className={`size-11 shrink-0 flex items-center justify-center rounded-lg theme-subtext-color hover:opacity-80 ${focusRing}`}
                    >
                        <X className="size-6" aria-hidden="true"/>
                    </button>
                </div>
                <div className="flex flex-col gap-1.5">
                    <label htmlFor={inputId} className={fieldLabelClass}>{fullEmail ? "Your email" : "Your school email"}</label>
                    <div className="flex items-center gap-2">
                        <input
                            ref={inputRef}
                            id={inputId}
                            type="text"
                            inputMode={fullEmail ? "email" : "numeric"}
                            maxLength={fullEmail ? 254 : 6}
                            autoComplete="off"
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            value={value}
                            onChange={e => setValue(fullEmail ? e.target.value : e.target.value.replace(/\D/g, ""))}
                            placeholder={fullEmail ? "name@example.com" : "123456"}
                            className={`${inputClass} flex-1 min-w-0 ${fullEmail ? "" : "tabular-nums tracking-widest"}`}
                        />
                        {!fullEmail && <span className="text-base md:text-sm theme-subtext-color shrink-0">{STUDENT_DOMAIN}</span>}
                    </div>
                    {error && <p role="alert" className="text-sm theme-danger">{error}</p>}
                </div>
                <div className="flex items-center justify-between gap-2">
                    <Button variant="text" onClick={switchMode}>
                        {fullEmail ? "Student? Use your number" : "Not a student? Use your email"}
                    </Button>
                    <div className="flex gap-2">
                        <Button variant="text" onClick={onClose}>Cancel</Button>
                        <Button type="submit" disabled={!typed || sending}>{sending ? "Checking…" : "Continue"}</Button>
                    </div>
                </div>
            </form>
        </Dialog>
    )
}
