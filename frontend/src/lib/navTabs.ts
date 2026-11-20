// Single source of truth for primary navigation. The desktop sidebar lists every
// tab; the mobile bottom bar (5 destinations at most, navigation.md) shows only
// those marked `mobile` plus More, which opens a sheet holding the rest
// (components/MoreSheet.tsx).

import {
    CalendarCheck, ClipboardList, LayoutDashboard, ListChecks, Milestone,
    Trophy, type LucideIcon,
} from "lucide-react"
import { can, type PermPolicy } from "./permissions"

export interface NavTab {
    to: string
    label: string
    icon: LucideIcon
    /** Shown in the mobile bottom bar. Tabs without it live in the More sheet there. */
    mobile?: boolean
    /** Optional gate; a tab with no predicate is always shown. */
    visible?: (perms: PermPolicy | null | undefined) => boolean
}

export const CORE_TABS: NavTab[] = [
    { to: "/dashboard",    label: "Dashboard",    icon: LayoutDashboard, mobile: true },
    { to: "/meetings",     label: "Meetings",     icon: CalendarCheck,   mobile: true },
    { to: "/events",       label: "Events",       icon: Milestone,       mobile: true },
    { to: "/tasks",        label: "Tasks",        icon: ListChecks,      mobile: true, visible: p => can(p, "tasks.view") },
    { to: "/leaderboards", label: "Leaderboards", icon: Trophy,          visible: p => can(p, "leaderboards.view") },
    { to: "/scouting",     label: "Scouting",     icon: ClipboardList,   visible: p => can(p, "scouting.view") },
]

/** The tabs the More sheet lists under Pages: every tab this role can see that isn't in the bar. */
export function moreTabs(perms: PermPolicy | null | undefined): NavTab[] {
    return CORE_TABS.filter(t => !t.mobile && (!t.visible || t.visible(perms)))
}

/** Routes reached through the More sheet besides its tabs: the Control Panel pages and Settings. */
const MORE_ROUTES = ["/control", "/settings"]

/**
 * Whether `pathname` is a page reached through the More sheet, so the bar's More
 * tab shows as current there. Ignores permissions: a page a role can't open
 * redirects away before this matters.
 */
export function isMorePage(pathname: string): boolean {
    const under = (to: string) => pathname === to || pathname.startsWith(to + "/")
    return CORE_TABS.some(t => !t.mobile && under(t.to)) || MORE_ROUTES.some(under)
}
