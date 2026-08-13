import { useState, useRef, useEffect } from "react"
import { Outlet, Link, useLocation } from "react-router-dom"
import { useAuth, useOnboardedUser } from "@/contexts/authContext"
import {
    LayoutDashboard, CalendarCheck, ClipboardList, Settings,
    LogOut, ChevronDown, PanelLeftClose, PanelLeftOpen, SlidersHorizontal, Milestone,
} from "lucide-react"
import Avatar from "@/components/Avatar.tsx"
import NotificationGate from "@/components/NotificationGate.tsx"
import { can, getPerm, type PermPolicy } from "@/lib/permissions"
import { visibleSections, type ControlSection } from "@/lib/controlSections"
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community"
import { useAppReady } from "@/contexts/appReadyContext"

ModuleRegistry.registerModules([AllCommunityModule])

const NAV_TEXT_KEY = "nav-show-text"

function getNavTextPref(): boolean {
    const stored = localStorage.getItem(NAV_TEXT_KEY)
    return stored === null ? true : stored === "true"
}

interface NavTab {
    to: string
    label: string
    icon: typeof LayoutDashboard
    /** Optional gate; a tab with no predicate is always shown. */
    visible?: (perms: PermPolicy | null | undefined) => boolean
}

const CORE_TABS: NavTab[] = [
    { to: "/dashboard",   label: "Dashboard",   icon: LayoutDashboard },
    { to: "/attendance",  label: "Attendance",  icon: CalendarCheck, visible: () => false },
    { to: "/events", label: "Events", icon: Milestone          },
    { to: "/scouting",    label: "Scouting",    icon: ClipboardList   },
]

const CONTROL_PANEL_TAB = {
    to: "/control",
    label: "Control Panel",
    icon: SlidersHorizontal,
}

export default function AppShell() {
    const { logout } = useAuth()
    // Guaranteed present + onboarded: AppShell only renders under <Protected>.
    const user = useOnboardedUser()
    const location = useLocation()
    const markReady = useAppReady()

    const [menuOpen,       setMenuOpen]       = useState(false)
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
    const menuRef       = useRef<HTMLDivElement>(null)
    const mobileMenuRef = useRef<HTMLDivElement>(null)

    const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
        localStorage.getItem("sidebar-collapsed") === "true"
    )

    const [showNavText, setShowNavText] = useState<boolean>(getNavTextPref)

    useEffect(() => {
        function onNavPrefsChange(e: Event) {
            setShowNavText((e as CustomEvent<{ showNavText: boolean }>).detail.showNavText)
        }
        window.addEventListener("nav-prefs-change", onNavPrefsChange)
        return () => window.removeEventListener("nav-prefs-change", onNavPrefsChange)
    }, [])

    useEffect(() => { markReady() }, [markReady])

    useEffect(() => {
        function onClickOutside(e: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
            if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target as Node)) setMobileMenuOpen(false)
        }
        document.addEventListener("mousedown", onClickOutside)
        return () => document.removeEventListener("mousedown", onClickOutside)
    }, [])

    useEffect(() => { setMobileMenuOpen(false) }, [location.pathname])

    function toggleSidebar() {
        setSidebarCollapsed(prev => {
            const next = !prev
            localStorage.setItem("sidebar-collapsed", String(next))
            return next
        })
    }

    const isActive = (to: string) =>
        location.pathname === to || location.pathname.startsWith(to + "/")

    const canViewControl = can(user.permissions, "control_panel.view")
    const isInsideEvent = /^\/events\/[^/]+/.test(location.pathname)

    // Core tabs can carry an optional `visible` predicate (e.g. Attendance is
    // student-only); an ungated tab is always shown. Both the desktop sidebar and
    // the mobile bar render this same filtered list so they never drift.
    const coreTabs = CORE_TABS.filter(t => !t.visible || t.visible(user.permissions))

    // Control Panel fans out into role-gated sub-pages; both this sidebar and the
    // mobile hub filter the same list through the same predicate so they never drift.
    const controlSections = visibleSections(user.permissions)

    // Mobile bottom bar keeps Control Panel as a single tab (→ hub of cards).
    const navTabs = canViewControl
        ? [...coreTabs, CONTROL_PANEL_TAB]
        : coreTabs

    // Human-readable role label comes from the backend policy; fall back to the
    // raw role slug if the role isn't in the policy map.
    const roleLabel = (getPerm(user.permissions, "label") as string | undefined) ?? user.role

    return (
        <div className="flex flex-col min-h-0 theme-bg-page bg-cover" style={{ height: "var(--real-vh, 100dvh)" }}>

            {/* ── Top header ──────────────────────────────────────── */}
            <header className={`shrink-0 border-b z-30 theme-bg theme-border${isInsideEvent ? " hidden md:block" : ""}`}>
                <div className="px-3 h-14 flex items-center justify-between gap-3">

                    <div className="flex items-center gap-1">
                        <button
                            onClick={toggleSidebar}
                            aria-label="Toggle sidebar"
                            className="hidden md:flex items-center justify-center w-9 h-9 rounded-lg theme-text opacity-50 hover:opacity-100 transition-opacity"
                        >
                            {sidebarCollapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
                        </button>

                        <Link to="/dashboard" className="flex items-center gap-2 select-none pl-1 md:pl-0">
                            <div className="relative w-8 h-8 shrink-0">
                                <div
                                    className="size-8 shrink-0 scale-125"
                                    style={{
                                        backgroundColor: "var(--theme-h1-color)",
                                        mask: "url(/sprocket_logo_gear.svg) center/contain no-repeat",
                                        WebkitMask: "url(/sprocket_logo_gear.svg) center/contain no-repeat",
                                    }}
                                />
                            </div>
                            <span className="font-bold text-base theme-text hidden sm:block">SprocketStats</span>
                        </Link>
                    </div>

                    {/* Desktop user menu */}
                    <div className="relative hidden md:block" ref={menuRef}>
                        <button
                            onClick={() => setMenuOpen(v => !v)}
                            className="flex items-center gap-2 px-2 py-1 rounded-lg hover:opacity-80 transition-opacity"
                        >
                            <Avatar name={user.name} picture={user.picture} size={28} />
                            <span className="text-sm font-medium theme-text">{user.display_name}</span>
                            <ChevronDown size={14} className="theme-text opacity-60" />
                        </button>

                        {menuOpen && (
                            <div className="absolute right-0 mt-1 w-52 rounded-xl border shadow-lg z-50 py-1 theme-bg theme-border">
                                <div className="px-3 py-2.5 border-b theme-border">
                                    <p className="text-sm font-semibold theme-text truncate">{user.display_name}</p>
                                    <p className="text-xs theme-subtext-color truncate">{user.email}</p>
                                    <p className="text-xs theme-text-contrast opacity-80 truncate mt-0.5">{roleLabel}</p>
                                </div>
                                <Link
                                    to="/settings"
                                    onClick={() => setMenuOpen(false)}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm theme-text hover:opacity-80 transition-opacity"
                                >
                                    <Settings size={14} />
                                    Settings
                                </Link>
                                <button
                                    onClick={() => { setMenuOpen(false); void logout() }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm theme-text hover:opacity-80 transition-opacity"
                                >
                                    <LogOut size={14} />
                                    Sign out
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Mobile profile dropdown */}
                    <div className="relative md:hidden shrink-0" ref={mobileMenuRef}>
                        <button
                            onClick={() => setMobileMenuOpen(v => !v)}
                            aria-label="Open profile menu"
                            aria-expanded={mobileMenuOpen}
                            className="block rounded-full hover:opacity-80 transition-opacity"
                        >
                            <Avatar name={user.name} picture={user.picture} size={32} />
                        </button>

                        {mobileMenuOpen && (
                            <div className="absolute right-0 mt-2 w-56 rounded-xl border shadow-lg z-50 py-1 theme-bg theme-border">
                                <div className="px-3 py-2.5 border-b theme-border flex items-center gap-2.5">
                                    <Avatar name={user.name} picture={user.picture} size={36} />
                                    <div className="min-w-0">
                                        <p className="text-sm font-semibold theme-text truncate">{user.display_name}</p>
                                        <p className="text-xs theme-subtext-color truncate">{user.email}</p>
                                        <p className="text-xs theme-text-contrast opacity-80 truncate mt-0.5">{roleLabel}</p>
                                    </div>
                                </div>
                                <Link
                                    to="/settings"
                                    onClick={() => setMobileMenuOpen(false)}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm theme-text hover:opacity-80 transition-opacity"
                                >
                                    <Settings size={14} />
                                    Settings
                                </Link>
                                <button
                                    onClick={() => { setMobileMenuOpen(false); void logout() }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm theme-text hover:opacity-80 transition-opacity"
                                >
                                    <LogOut size={14} />
                                    Sign out
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </header>

            {/* ── Body: sidebar + content ──────────────────────────── */}
            <div className="flex-1 flex min-h-0">

                {/* Desktop sidebar */}
                <aside
                    className="hidden md:flex flex-col shrink-0 border-r overflow-hidden theme-bg theme-border"
                    style={{
                        width: sidebarCollapsed ? "56px" : "196px",
                        transition: "width 0.22s cubic-bezier(0.4, 0, 0.2, 1)",
                    }}
                >
                    <nav className="flex flex-col gap-0.5 p-2 pt-3">
                        {coreTabs.map(({ to, label, icon: Icon }) => {
                            const active = isActive(to)
                            return (
                                <Link
                                    key={to}
                                    to={to}
                                    title={sidebarCollapsed ? label : undefined}
                                    className={[
                                        "flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm font-medium transition-all",
                                        active ? "theme-text-contrast" : "theme-text opacity-55 hover:opacity-90",
                                    ].join(" ")}
                                    style={active ? { background: "color-mix(in oklch, var(--theme-button-bg) 18%, transparent)" } : {}}
                                >
                                    <Icon size={18} className="shrink-0" />
                                    <span
                                        className="truncate whitespace-nowrap overflow-hidden"
                                        style={{
                                            opacity: sidebarCollapsed ? 0 : 1,
                                            width: sidebarCollapsed ? 0 : "auto",
                                            transition: "opacity 0.15s ease",
                                        }}
                                    >
                                        {label}
                                    </span>
                                </Link>
                            )
                        })}

                        {canViewControl && (
                            <ControlPanelNav
                                sections={controlSections}
                                collapsed={sidebarCollapsed}
                                pathname={location.pathname}
                            />
                        )}
                    </nav>
                </aside>

                <main className="flex-1 min-h-0 overflow-auto theme-scrollbar">
                    <Outlet />
                </main>
            </div>

            {/* ── Mobile bottom tab bar ───────────────────────────── */}
            <nav
                className={`${isInsideEvent ? "hidden" : "md:hidden"} shrink-0 border-t z-30 theme-bg theme-border`}
                style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
            >
                <div className={showNavText ? "flex h-24" : "flex h-20"}>
                    {navTabs.map(({ to, label, icon: Icon }) => {
                        const active = isActive(to)
                        return (
                            <Link
                                key={to}
                                to={to}
                                className={`flex-1 flex flex-col items-center justify-start pt-4 gap-0.5 transition-opacity ${active ? "theme-text-contrast" : "theme-text"}`}
                                style={{ opacity: active ? 1 : 0.45 }}
                            >
                                <Icon size={21} strokeWidth={active ? 2.2 : 1.8} />
                                {showNavText && (
                                    <span className="font-medium text-[10px] tracking-[0.01em]">
                                        {label}
                                    </span>
                                )}
                            </Link>
                        )
                    })}
                </div>
            </nav>

            <NotificationGate />

            <style>{`
                @keyframes spin     { to { transform: rotate(360deg);  } }
                @keyframes spin-rev { to { transform: rotate(-360deg); } }
            `}</style>
        </div>
    )
}

/**
 * Desktop sidebar navigation for the Control Panel and its role-gated sub-pages.
 *
 * Expanded sidebar → inline accordion: the parent row toggles the section list,
 * the sub-items navigate. Collapsed sidebar → the parent becomes an icon with a
 * hover flyout listing the same sub-items (there's no room for inline text).
 * Both drive the pre-filtered `sections`, so a user only ever sees what their
 * role grants. The mobile bottom bar keeps Control Panel as a single tab.
 */
function ControlPanelNav({
    sections,
    collapsed,
    pathname,
}: {
    sections: ControlSection[]
    collapsed: boolean
    pathname: string
}) {
    const parentActive = pathname.startsWith("/control")
    const [open, setOpen] = useState(parentActive)

    // Keep the accordion open whenever we're on a control route (deep-link, or
    // navigating in from the mobile hub then resizing the window up).
    useEffect(() => { if (parentActive) setOpen(true) }, [parentActive])

    const rowClass = (active: boolean) => [
        "flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm font-medium transition-all w-full",
        active ? "theme-text-contrast" : "theme-text opacity-55 hover:opacity-90",
    ].join(" ")
    const activeStyle = (active: boolean) =>
        active ? { background: "color-mix(in oklch, var(--theme-button-bg) 18%, transparent)" } : {}

    // Collapsed: icon + hover flyout.
    if (collapsed) {
        return (
            <div className="relative group">
                <Link to="/control" title="Control Panel" className={rowClass(parentActive)} style={activeStyle(parentActive)}>
                    <SlidersHorizontal size={18} className="shrink-0" />
                </Link>
                <div className="absolute left-full top-0 ml-2 z-50 hidden group-hover:block min-w-44 rounded-xl border shadow-lg py-1 theme-bg theme-border">
                    <div className="px-3 py-1.5 text-xs font-semibold theme-subtext-color">Control Panel</div>
                    {sections.map(({ to, label, icon: Icon }) => {
                        const active = pathname === `/control/${to}`
                        return (
                            <Link
                                key={to}
                                to={`/control/${to}`}
                                className={`flex items-center gap-2.5 px-3 py-2 text-sm ${active ? "theme-text-contrast" : "theme-text opacity-70 hover:opacity-100"}`}
                            >
                                <Icon size={16} className="shrink-0" />
                                {label}
                            </Link>
                        )
                    })}
                </div>
            </div>
        )
    }

    // Expanded: inline accordion.
    return (
        <div className="flex flex-col">
            <button onClick={() => setOpen(v => !v)} className={rowClass(parentActive)} style={activeStyle(parentActive)}>
                <SlidersHorizontal size={18} className="shrink-0" />
                <span className="flex-1 text-left truncate">Control Panel</span>
                <ChevronDown
                    size={15}
                    className="shrink-0 transition-transform"
                    style={{ transform: open ? "rotate(180deg)" : "none" }}
                />
            </button>
            {open && (
                <div className="flex flex-col gap-0.5 mt-0.5 pl-3 ml-2 border-l theme-border">
                    {sections.map(({ to, label, icon: Icon }) => {
                        const active = pathname === `/control/${to}`
                        return (
                            <Link key={to} to={`/control/${to}`} className={rowClass(active)} style={activeStyle(active)}>
                                <Icon size={16} className="shrink-0" />
                                <span className="truncate">{label}</span>
                            </Link>
                        )
                    })}
                </div>
            )}
        </div>
    )
}