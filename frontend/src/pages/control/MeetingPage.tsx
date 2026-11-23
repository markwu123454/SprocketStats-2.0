import { useCallback, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useOnboardedUser } from "@/contexts/authContext"
import { can } from "@/lib/permissions"
import ControlSectionLayout from "./ControlSectionLayout"
import MeetingHoursEditor from "./MeetingHoursEditor"
import MeetingAgendaEditor from "./MeetingAgendaEditor"

/**
 * Meeting control page — one page for both meeting time and agenda.
 *
 * Visibility of the page is decided by the route guard (reachable if the user
 * can edit either the time or the agenda). Which editors actually render is
 * gated here, per capability: a captain/mentor sees both; a lead with only
 * `meeting_agenda` sees the agenda editor alone. The backend independently
 * enforces each action, so these checks are purely for UI.
 */
export default function MeetingPage() {
    const user = useOnboardedUser()
    // ?meeting=<id>, from a meeting card's pen on the Meetings page: open that meeting for editing.
    const [params] = useSearchParams()
    const meetingId = params.get("meeting") ?? undefined
    const [revision, setRevision] = useState(0)
    const onMeetingsChanged = useCallback(() => setRevision(value => value + 1), [])
    const canTime   = can(user.permissions, "control_panel.meeting_time")
    const canAgenda = can(user.permissions, "control_panel.meeting_agenda")

    return (
        <ControlSectionLayout title="Manage meetings">
            {canTime && (
                <MeetingHoursEditor onChanged={onMeetingsChanged} editId={meetingId} />
            )}

            {canAgenda && (
                <MeetingAgendaEditor revision={revision} initialMeetingId={meetingId} />
            )}
        </ControlSectionLayout>
    )
}
