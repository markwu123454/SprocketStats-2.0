import { useCallback, useState } from "react"
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
    const [revision, setRevision] = useState(0)
    const onMeetingsChanged = useCallback(() => setRevision(value => value + 1), [])
    const canTime   = can(user.permissions, "control_panel.meeting_time")
    const canAgenda = can(user.permissions, "control_panel.meeting_agenda")

    return (
        <ControlSectionLayout title="Meeting">
            {canTime && (
                <MeetingHoursEditor onChanged={onMeetingsChanged} />
            )}

            {canAgenda && (
                <MeetingAgendaEditor revision={revision} />
            )}
        </ControlSectionLayout>
    )
}
