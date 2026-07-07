import { useOnboardedUser } from "@/contexts/authContext.tsx"
import { can } from "@/lib/permissions"
import ControlSectionLayout from "./ControlSectionLayout"

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
                <section className="flex flex-col gap-2">
                    <h2 className="text-sm font-semibold theme-text">Meeting Time</h2>
                    <p className="text-sm theme-subtext-color">Set and manage the meeting time.</p>
                </section>
            )}

            {canAgenda && (
                <section className="flex flex-col gap-2">
                    <h2 className="text-sm font-semibold theme-text">Meeting Agenda</h2>
                    <p className="text-sm theme-subtext-color">Draft and share the meeting agenda.</p>
                </section>
            )}
        </ControlSectionLayout>
    )
}
