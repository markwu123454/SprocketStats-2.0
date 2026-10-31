import { useState } from "react"
import Button from "@/components/ui/Button"
import Dropdown from "@/components/ui/Dropdown"
import FormFooter from "@/components/ui/FormFooter"
import Notice from "@/components/ui/Notice"
import Skeleton from "@/components/ui/Skeleton"
import EmptyState from "@/components/ui/EmptyState"
import { cardClass, fieldLabelClass, inputClass, typeH2 } from "@/lib/uiClasses"
import { confirmAnyDiscard, useDiscardGuard } from "@/lib/useDiscardGuard"
import { MEETINGS_API, type Meeting, meetingDate, meetingTime, useMeetings } from "@/lib/meetings"

function AgendaForm({ meeting, onSaved, onSaving }: { meeting: Meeting, onSaved: (meeting: Meeting) => void, onSaving: (saving: boolean) => void }) {
    const [agenda, setAgenda] = useState(meeting.agenda)
    const [baseline, setBaseline] = useState(meeting.agenda)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState(false)
    const [saved, setSaved] = useState(false)
    const dirty = agenda !== baseline
    const confirmDiscard = useDiscardGuard(dirty)

    async function save() {
        setSaving(true)
        onSaving(true)
        setError(false)
        setSaved(false)
        try {
            const response = await fetch(`${MEETINGS_API}/${meeting.id}/agenda`, {
                method: "PATCH", credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ agenda }),
            })
            if (!response.ok) throw new Error("save")
            const updated: Meeting = await response.json()
            setAgenda(updated.agenda)
            setBaseline(updated.agenda)
            onSaved(updated)
            setSaved(true)
        } catch {
            setError(true)
        } finally {
            setSaving(false)
            onSaving(false)
        }
    }

    return <form className="flex flex-col gap-3" onSubmit={event => { event.preventDefault(); void save() }}>
        <label htmlFor="meeting-agenda" className={fieldLabelClass}>Agenda (optional)</label>
        <textarea id="meeting-agenda" className={`${inputClass} w-full min-h-48 resize-y`} value={agenda} maxLength={10000} disabled={saving}
            aria-describedby="agenda-help" onChange={event => { setAgenda(event.target.value); setSaved(false) }} placeholder="Topics, goals, and what to bring…" />
        <p id="agenda-help" className="text-xs theme-subtext-color">Saved agendas are visible to the team. Clear the text to remove an agenda. {agenda.length.toLocaleString()}/10,000 characters.</p>
        {error && <Notice>Couldn't save the agenda. Your changes are still here; try again.</Notice>}
        <FormFooter>
            <span role="status" className="text-xs theme-subtext-color">{saved ? "Agenda saved" : ""}</span>
            <Button variant="text" size="footer" className="ml-auto" disabled={saving || !dirty} onClick={async () => {
                if (await confirmDiscard()) { setAgenda(baseline); setError(false) }
            }}>Cancel</Button>
            <Button type="submit" size="footer" disabled={saving || !dirty}>{saving ? "Saving…" : "Save agenda"}</Button>
        </FormFooter>
    </form>
}

export default function MeetingAgendaEditor({ revision }: { revision: number }) {
    const { meetings, setMeetings, loading, error, retry } = useMeetings(revision)
    const [selectedId, setSelectedId] = useState("")
    const [saving, setSaving] = useState(false)
    const selected = meetings.find(meeting => meeting.id === selectedId)
        ?? meetings.find(meeting => Date.parse(meeting.end_time) > Date.now()) ?? meetings[0]

    return <section className={`${cardClass} theme-bg`}>
        <h2 className={`${typeH2} theme-subtext-color`}>Meeting agenda</h2>
        <p className="text-sm theme-subtext-color">Choose a meeting and share the plan with the team.</p>
        {loading && meetings.length === 0 ? <Skeleton className="h-48 w-full" />
            : error ? <Notice>Couldn't load meetings. <Button variant="text" onClick={retry}>Try again</Button></Notice>
            : !selected ? <EmptyState>No meetings scheduled yet. Add a meeting above or ask a captain or mentor to schedule one.</EmptyState>
            : <>
                <Dropdown label="Meeting" value={selected.id} disabled={saving} searchable triggerClassName={`${inputClass} w-full`}
                    options={meetings.map(meeting => ({ value: meeting.id, label: `${meetingDate(meeting.start_time)} · ${meetingTime(meeting)} · ${meeting.meeting_purpose || "Team meeting"}` }))}
                    onChange={async id => { if (await confirmAnyDiscard()) setSelectedId(id) }} />
                <AgendaForm key={selected.id} meeting={selected} onSaving={setSaving} onSaved={updated => setMeetings(rows => rows.map(row => row.id === updated.id ? updated : row))} />
            </>}
    </section>
}
