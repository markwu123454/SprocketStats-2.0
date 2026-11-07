// Single source of truth for primary navigation. The desktop sidebar lists every
// tab; the mobile bottom bar (5 destinations at most, navigation.md) shows only
// those marked `mobile` plus "Other", whose page lists the rest as cards.

import {
    CalendarCheck, ClipboardList, LayoutDashboard, LayoutGrid, ListChecks, Milestone,
    Settings, SlidersHorizontal, Trophy, type LucideIcon,
} from "lucide-react"
import { can, type PermPolicy } from "./permissions"

export interface NavTab {
    to: string
    label: string
    icon: LucideIcon
    /** Shown in the mobile bottom bar. Tabs without it live on the Other page there. */
    mobile?: boolean
    /** Optional gate; a tab with no predicate is always shown. */
    visible?: (perms: PermPolicy | null | undefined) => boolean
}

export const CORE_TABS: NavTab[] = [
    { to: "/dashboard",    label: "Dashboard",    icon: LayoutDashboard, mobile: true },
    { to: "/meetings",     label: "Meetings",     icon: CalendarCheck,   mobile: true },
    { to: "/events",       label: "Events",       icon: Milestone,       mobile: true },
    { to: "/tasks",        label: "Tasks",        icon: ListChecks,      mobile: true, visible: p => can(p, "tasks.view") },
    { to: "/leaderboards", label: "Leaderboards", icon: Trophy },
    { to: "/scouting",     label: "Scouting",     icon: ClipboardList },
]

export const CONTROL_PANEL_TAB: NavTab = {
    to: "/control",
    label: "Control Panel",
    icon: SlidersHorizontal,
}

export const OTHER_TAB: NavTab = { to: "/other", label: "Other", icon: LayoutGrid }

const SETTINGS_PAGE: NavTab = { to: "/settings", label: "Settings", icon: Settings }

/** Pages reachable from the Other page: every non-bar tab, Control Panel if allowed, Settings. */
export function otherPages(perms: PermPolicy | null | undefined): NavTab[] {
    const visible = (t: NavTab) => !t.visible || t.visible(perms)
    return [
        ...CORE_TABS.filter(t => !t.mobile && visible(t)),
        ...(can(perms, "control_panel.view") ? [CONTROL_PANEL_TAB] : []),
        SETTINGS_PAGE,
    ]
}
