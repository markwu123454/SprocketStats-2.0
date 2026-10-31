import { useOnboardedUser } from "@/contexts/authContext"
import { can } from "@/lib/permissions"
import ControlSectionLayout from "./ControlSectionLayout"
import MeetingHoursEditor from "./MeetingHoursEditor"
import { typeH2 } from "@/lib/uiClasses"

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
    const canTime   = can(user.permissions, "control_panel.meeting_time")
    const canAgenda = can(user.permissions, "control_panel.meeting_agenda")

    return (
        <ControlSectionLayout title="Meeting">
            {canTime && (
                <MeetingHoursEditor />
            )}

            {canAgenda && (
                <section className="flex flex-col gap-2 rounded-xl border p-5 theme-border theme-bg">
                    <h2 className={`${typeH2} theme-subtext-color`}>Meeting Agenda</h2>
                    <p className="text-sm theme-subtext-color">Draft and share the meeting agenda.</p>
                </section>
            )}
        </ControlSectionLayout>
    )
}
