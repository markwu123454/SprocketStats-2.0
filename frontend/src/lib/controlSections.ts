// Single source of truth for the Control Panel's sub-pages.
//
// The Control Panel is one nav tab (mobile has room for ~5 tabs total) that fans
// out into several sub-pages. Crucially, a page is NOT one-to-one with a single
// permission: a page can be reachable under a boolean combination of
// capabilities (today just "any of", but the predicate shape leaves room for
// AND/XOR/etc. later), and a page then reads the individual capabilities itself
// to gate specific actions/fields. So "Meeting" is one page visible to anyone
// who can edit the time OR the agenda; inside, the time and agenda editors are
// each gated separately.
//
// Every surface — desktop sidebar accordion, collapsed-sidebar flyout, mobile
// hub, and the route guard — filters this list through the same `visible`
// predicate, so they never drift. Gating here is cosmetic; the backend still
// enforces each action on the real endpoints.

import { Bell, CalendarClock, CalendarPlus, Send, Users, type LucideIcon } from "lucide-react"
import { can, type PermPolicy } from "./permissions"

/** Convenience: dotted capability paths all live under `control_panel.`. */
const CP = "control_panel."

export interface ControlSection {
    /** Route segment under `/control` (e.g. "meeting" → /control/meeting). */
    to: string
    label: string
    icon: LucideIcon
    /** Whether this page is reachable for the given policy (any boolean logic). */
    visible: (perms: PermPolicy | null | undefined) => boolean
}

export const CONTROL_SECTIONS: ControlSection[] = [
    {
        to: "meeting",
        label: "Meeting",
        icon: CalendarClock,
        // One page for time + agenda; reachable if you can edit either.
        visible: p => can(p, CP + "meeting_time") || can(p, CP + "meeting_agenda"),
    },
    {
        to: "upcoming-event",
        label: "Upcoming Event",
        icon: CalendarPlus,
        visible: p => can(p, CP + "upcoming_event"),
    },
    {
        to: "members",
        label: "Members",
        icon: Users,
        // Full member roster (includes emails); Captains and Mentors only.
        visible: p => can(p, CP + "members"),
    },
    {
        to: "notifications",
        label: "Notifications",
        icon: Bell,
        visible: p => can(p, CP + "notifications"),
    },
    {
        to: "push",
        label: "Push Notifications",
        icon: Send,
        // Separate page/feature from dashboard Notifications above -- same
        // authoring permission, but its own table, endpoints, and history.
        visible: p => can(p, CP + "notifications"),
    },
]

/** The sections a given policy can see, in declaration order. */
export function visibleSections(perms: PermPolicy | null | undefined): ControlSection[] {
    return CONTROL_SECTIONS.filter(s => s.visible(perms))
}
