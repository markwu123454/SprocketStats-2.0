import { useState, useRef, useEffect } from "react"
import { Outlet, Link, useLocation } from "react-router-dom"
import { useAuth } from "@/contexts/authContext.tsx"
import {
    LayoutDashboard, CalendarCheck, Trophy, ClipboardList, Settings,
    LogOut, ChevronDown, PanelLeftClose, PanelLeftOpen,
} from "lucide-react"
import { formatRole } from "@/pages/OnboardingPage.tsx"
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community"
import { useAppReady } from "@/contexts/appReadyContext.tsx"

ModuleRegistry.registerModules([AllCommunityModule])

const NAV_TEXT_KEY = "nav-show-text"

function getNavTextPref(): boolean {
    const stored = localStorage.getItem(NAV_TEXT_KEY)
    return stored === null ? true : stored === "true"
}

const NAV_TABS = [
    { to: "/dashboard",   label: "Dashboard",   icon: LayoutDashboard },
    { to: "/attendance",  label: "Attendance",  icon: CalendarCheck },
    { to: "/competition", label: "Competition", icon: Trophy },
    { to: "/scouting",    label: "Scouting",    icon: ClipboardList },
    { to: "/settings",    label: "Settings",    icon: Settings },
]

export default function AppShell() {
    const { user, logout } = useAuth()
    const location = useLocation()
    const markReady = useAppReady()

    const [menuOpen, setMenuOpen] = useState(false)
    const menuRef = useRef<HTMLDivElement>(null)

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

    useEffect(() => { markReady() }, [])

    useEffect(() => {
        function onClickOutside(e: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuOpen(false)
            }
        }
        document.addEventListener("mousedown", onClickOutside)
        return () => document.removeEventListener("mousedown", onClickOutside)
    }, [])

    function toggleSidebar() {
        setSidebarCollapsed(prev => {
            const next = !prev
            localStorage.setItem("sidebar-collapsed", String(next))
            return next
        })
    }

    const isActive = (to: string) => location.pathname === to

    return (
        <div className="h-dvh flex flex-col min-h-0 theme-bg-page bg-cover">

            {/* ── Top header ──────────────────────────────────────── */}
            <header className="shrink-0 border-b z-30 theme-bg theme-border">
                <div className="px-3 h-14 flex items-center justify-between gap-3">

                    {/* Left: sidebar toggle (desktop) + logo */}
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
                                <img
                                    className="absolute inset-0 w-full h-full scale-125"
                                    src="/sprocket_logo_gear.svg"
                                    alt=""
                                />
                            </div>
                            <span className="font-bold text-base theme-text hidden sm:block">SprocketStats</span>
                        </Link>
                    </div>

                    {/* Right: desktop user menu */}
                    {user && (
                        <div className="relative hidden md:block" ref={menuRef}>
                            <button
                                onClick={() => setMenuOpen(v => !v)}
                                className="flex items-center gap-2 px-2 py-1 rounded-lg hover:opacity-80 transition-opacity"
                            >
                                <img
                                    src={user.picture}
                                    alt={user.name}
                                    className="w-7 h-7 rounded-full"
                                    referrerPolicy="no-referrer"
                                />
                                <span className="text-sm font-medium theme-text">{user.display_name ?? user.given_name}</span>
                                <ChevronDown size={14} className="theme-text opacity-60" />
                            </button>

                            {menuOpen && (
                                <div className="absolute right-0 mt-1 w-52 rounded-xl border shadow-lg z-50 py-1 theme-bg theme-border">
                                    <div className="px-3 py-2.5 border-b theme-border">
                                        <p className="text-sm font-semibold theme-text truncate">{user.display_name ?? user.name}</p>
                                        <p className="text-xs theme-subtext-color truncate">{user.email}</p>
                                        {user.role && (
                                            <p className="text-xs theme-text-contrast opacity-80 truncate mt-0.5">{formatRole(user.role)}</p>
                                        )}
                                    </div>
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
                    )}

                    {user && (
                        <Link to="/settings" className="md:hidden shrink-0">
                            <img
                                src={user.picture}
                                alt={user.name}
                                className="w-8 h-8 rounded-full"
                                referrerPolicy="no-referrer"
                            />
                        </Link>
                    )}
                </div>
            </header>

            {/* ── Body row: sidebar + content ─────────────────────── */}
            <div className="flex-1 flex min-h-0">

                {/* ── Desktop left sidebar ── */}
                <aside
                    className="hidden md:flex flex-col shrink-0 border-r overflow-hidden theme-bg theme-border"
                    style={{
                        width: sidebarCollapsed ? "56px" : "196px",
                        transition: "width 0.22s cubic-bezier(0.4, 0, 0.2, 1)",
                    }}
                >
                    <nav className="flex flex-col gap-0.5 p-2 pt-3">
                        {NAV_TABS.map(({ to, label, icon: Icon }) => {
                            const active = isActive(to)
                            return (
                                <Link
                                    key={to}
                                    to={to}
                                    title={sidebarCollapsed ? label : undefined}
                                    className={[
                                        "flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm font-medium transition-all",
                                        active
                                            ? "theme-text-contrast"
                                            : "theme-text opacity-55 hover:opacity-90",
                                    ].join(" ")}
                                    style={active ? {
                                        background: "color-mix(in oklch, var(--theme-button-bg) 18%, transparent)",
                                    } : {}}
                                >
                                    <Icon size={18} className="shrink-0" />
                                    <span
                                        className="truncate whitespace-nowrap"
                                        style={{
                                            opacity: sidebarCollapsed ? 0 : 1,
                                            width: sidebarCollapsed ? 0 : "auto",
                                            overflow: "hidden",
                                            transition: "opacity 0.15s ease",
                                        }}
                                    >
                                        {label}
                                    </span>
                                </Link>
                            )
                        })}
                    </nav>
                </aside>

                {/* ── Page content ── */}
                <main className="flex-1 min-h-0 overflow-auto theme-scrollbar">
                    <Outlet />
                </main>
            </div>

            {/* ── Mobile bottom tab bar ───────────────────────────── */}
            <nav
                className="md:hidden shrink-0 border-t z-30 theme-bg theme-border"
                style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
            >
                <div className={showNavText ? "flex h-20" : "flex h-16"}>
                    {NAV_TABS.map(({ to, label, icon: Icon }) => {
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
                                    <span
                                        className="font-medium"
                                        style={{ fontSize: "10px", letterSpacing: "0.01em" }}
                                    >
                                        {label}
                                    </span>
                                )}
                            </Link>
                        )
                    })}
                </div>
            </nav>

            <style>{`
                @keyframes spin     { to { transform: rotate(360deg);  } }
                @keyframes spin-rev { to { transform: rotate(-360deg); } }
            `}</style>
        </div>
    )
}