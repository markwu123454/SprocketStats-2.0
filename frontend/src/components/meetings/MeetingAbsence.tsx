import { useId, useState } from "react"
import { ChevronDown, UserX } from "lucide-react"
import Button from "@/components/ui/Button"
import FormFooter from "@/components/ui/FormFooter"
import Notice from "@/components/ui/Notice"
import Sheet from "@/components/ui/Sheet"
import { confirmDialog } from "@/lib/confirmDialog"
import { askDiscard } from "@/lib/useDiscardGuard"
import { fieldLabelClass, focusRing, helperClass, inputClass } from "@/lib/uiClasses"
import { meetingDate, reportAbsence, withdrawAbsence, type Meeting, type MeetingAbsence } from "@/lib/meetings"

const MAX_REASON = 500

function AbsenceSheet({ meeting, existing, onClose, onSaved }: { meeting: Meeting, existing?: MeetingAbsence, onClose: () => void, onSaved: () => void }) {
    const formId = useId()
    const fieldId = useId()
    const helpId = useId()
    const [reason, setReason] = useState(existing?.reason ?? "")
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState("")
    const dirty = reason !== (existing?.reason ?? "")

    async function withdraw() {
        if (!existing) return
        const ok = await confirmDialog({ title: "Withdraw absence?", body: "Your report for this meeting will be removed.", confirmLabel: "Withdraw", danger: true })
        if (!ok) return
        setSaving(true)
        setError("")
        try {
            await withdrawAbsence(meeting.id)
            onSaved()
            onClose()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't withdraw your absence. Try again.")
            setSaving(false)
        }
    }

    async function submit() {
        const trimmed = reason.trim()
        if (!trimmed) {
            setError("Please enter a reason.")
            return
        }
        setSaving(true)
        setError("")
        try {
            await reportAbsence(meeting.id, trimmed)
            onSaved()
            onClose()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't save your absence. Try again.")
            setSaving(false)
        }
    }

    return <Sheet title={existing ? "Edit absence" : "Report absence"} dirty={dirty} onClose={onClose} footer={
        <FormFooter safeArea>
            {existing && <Button variant="danger" size="footer" className="mr-auto" disabled={saving} onClick={() => void withdraw()}>Withdraw absence</Button>}
            <Button variant="text" size="footer" className={existing ? "" : "ml-auto"} disabled={saving} onClick={async () => {
                if (!dirty || await askDiscard()) onClose()
            }}>Cancel</Button>
            <Button type="submit" form={formId} size="footer" disabled={saving || !reason.trim()}>{saving ? "Saving…" : existing ? "Save" : "Report absence"}</Button>
        </FormFooter>
    }>
        <form id={formId} className="flex flex-col gap-3 pt-2" onSubmit={event => { event.preventDefault(); void submit() }}>
            <div className="min-w-0">
                <p className="text-sm font-semibold theme-text break-words">{meeting.meeting_purpose || "Team meeting"}</p>
                <p className="text-sm theme-subtext-color">{meetingDate(meeting.start_time)}</p>
            </div>
            <label htmlFor={fieldId} className={fieldLabelClass}>Reason</label>
            <textarea id={fieldId} className={`${inputClass} w-full min-h-28 resize-y`} value={reason} maxLength={MAX_REASON} disabled={saving}
                required aria-describedby={helpId} onChange={event => { setReason(event.target.value); if (error) setError("") }} />
            <p id={helpId} className={helperClass}>Required. Your lead, captains and mentors can see this. {reason.length}/{MAX_REASON} characters.</p>
            {error && <Notice>{error}</Notice>}
        </form>
    </Sheet>
}

interface MeetingAbsenceRowProps {
    meeting: Meeting
    mine?: MeetingAbsence
    /** Other members' absences; only passed for leads, captains and mentors. */
    others?: MeetingAbsence[]
    roleLabels: Map<string, string>
    onChanged: () => void
}

const linkButton = `inline-flex items-center gap-2 py-2 -my-2 text-sm font-semibold theme-text-contrast transition-opacity hover:opacity-90 active:opacity-70 rounded-lg ${focusRing}`

/** Bottom action area of a meeting card: own report control, absent count and list. */
export function MeetingAbsenceRow({ meeting, mine, others, roleLabels, onChanged }: MeetingAbsenceRowProps) {
    const [open, setOpen] = useState(false)
    const [expanded, setExpanded] = useState(false)
    const listId = useId()
    const count = others?.length ?? 0
    const toggle = count > 0 && <button type="button" className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap py-2 -my-2 text-[13px] theme-subtext-color rounded-lg ${focusRing}`}
        aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(value => !value)}>
        {count} absent<ChevronDown size={14} aria-hidden="true" className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
    </button>

    return <div className="mt-3 flex flex-col gap-3">
        {mine
            ? <>
                <div className="flex items-start gap-2">
                    <UserX size={16} className="shrink-0 mt-0.5 theme-text-contrast" aria-hidden="true" />
                    <p className="min-w-0 flex-1 text-sm sm:truncate">
                        <span className="font-semibold theme-text-contrast">You're marked absent</span>
                        {mine.reason && <>
                            <span className="hidden sm:inline theme-subtext-color"> · {mine.reason}</span>
                            <span className="block sm:hidden theme-subtext-color break-words whitespace-pre-wrap">{mine.reason}</span>
                        </>}
                    </p>
                    <button type="button" className={`${linkButton} shrink-0`} onClick={() => setOpen(true)}>Edit</button>
                </div>
            </>
            : <div><button type="button" className={`${linkButton} whitespace-nowrap`} onClick={() => setOpen(true)}>Report absence <span aria-hidden="true">→</span></button></div>}
        {toggle && <div className="-mt-1">{toggle}</div>}
        {others && expanded && count > 0 && <ul id={listId} className="flex flex-col divide-y theme-border border-t border-dashed theme-border pt-2.5">
            {others.map(absence => <li key={absence.user_id} className="py-2 first:pt-0 last:pb-0 min-w-0">
                <p className="text-sm font-semibold theme-text break-words">{absence.display_name}</p>
                <p className="text-xs theme-subtext-color">{roleLabels.get(absence.role) ?? absence.role}</p>
                <p className="text-sm theme-subtext-color break-words whitespace-pre-wrap">{absence.reason || "No reason given"}</p>
            </li>)}
        </ul>}
        {open && <AbsenceSheet meeting={meeting} existing={mine} onClose={() => setOpen(false)} onSaved={onChanged} />}
    </div>
}
