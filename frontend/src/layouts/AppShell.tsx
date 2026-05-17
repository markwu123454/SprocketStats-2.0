import { Outlet, Link, useLocation } from "react-router-dom"
import { useAuth } from "@/contexts/authContext.tsx"
import { LayoutDashboard, LogOut, ChevronDown } from "lucide-react"
import { useState, useRef, useEffect } from "react"
import {AllCommunityModule, ModuleRegistry} from 'ag-grid-community';
import {useAppReady} from "@/contexts/appReadyContext.tsx";
ModuleRegistry.registerModules([AllCommunityModule]);

export default function AppShell() {
    const { user, logout } = useAuth()
    const location = useLocation()
    const [menuOpen, setMenuOpen] = useState(false)
    const menuRef = useRef<HTMLDivElement>(null)
    const markReady = useAppReady()

    useEffect(() => { markReady() }, [])

    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuOpen(false)
            }
        }
        document.addEventListener("mousedown", handleClick)
        return () => document.removeEventListener("mousedown", handleClick)
    }, [])

    const navLinks = [
        { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    ]

    return (
        <div className="h-screen flex flex-col min-h-0 theme-bg-page bg-cover">
            {/* Top nav */}
            <header className="shrink-0 border-b theme-border" style={{ background: "var(--theme-bg)" }}>
                <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
                    {/* Logo + brand */}
                    <Link to="/dashboard" className="flex items-center gap-2 select-none">
                        <div className="relative w-8 h-8">
                            <img
                                className="absolute inset-0 w-full h-full object-contain"
                                style={{ animation: "spin 14s linear infinite" }}
                                src="/static/sprocket_logo_ring.png"
                                alt=""
                            />
                            <img
                                className="absolute inset-0 w-full h-full object-contain"
                                style={{ animation: "spin-rev 10s linear infinite" }}
                                src="/static/sprocket_logo_gear.png"
                                alt=""
                            />
                        </div>
                        <span className="font-bold text-base theme-text hidden sm:block">SprocketStats</span>
                    </Link>

                    {/* Nav links */}
                    <nav className="flex items-center gap-1">
                        {navLinks.map(({ to, label, icon: Icon }) => (
                            <Link
                                key={to}
                                to={to}
                                className={[
                                    "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                                    location.pathname === to
                                        ? "theme-text-contrast"
                                        : "theme-text opacity-70 hover:opacity-100",
                                ].join(" ")}
                            >
                                <Icon size={15} />
                                {label}
                            </Link>
                        ))}
                    </nav>

                    {/* User menu */}
                    {user && (
                        <div className="relative" ref={menuRef}>
                            <button
                                onClick={() => setMenuOpen(v => !v)}
                                className="flex items-center gap-2 px-2 py-1 rounded-md hover:opacity-80 transition-opacity"
                            >
                                <img
                                    src={user.picture}
                                    alt={user.name}
                                    className="w-7 h-7 rounded-full"
                                    referrerPolicy="no-referrer"
                                />
                                <span className="text-sm font-medium theme-text hidden sm:block">{user.given_name}</span>
                                <ChevronDown size={14} className="theme-text opacity-60" />
                            </button>

                            {menuOpen && (
                                <div
                                    className="absolute right-0 mt-1 w-48 rounded-lg border shadow-lg z-50 py-1 animate-slide-up"
                                    style={{ background: "var(--theme-bg)", borderColor: "var(--theme-border)" }}
                                >
                                    <div className="px-3 py-2 border-b" style={{ borderColor: "var(--theme-border)" }}>
                                        <p className="text-sm font-medium theme-text truncate">{user.name}</p>
                                        <p className="text-xs theme-subtext-color truncate">{user.email}</p>
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
                </div>
            </header>

            {/* Page content */}
            <main className="flex-1 min-h-0 overflow-auto theme-scrollbar">
                <Outlet />
            </main>

            <style>{`
                @keyframes spin { to { transform: rotate(360deg); } }
                @keyframes spin-rev { to { transform: rotate(-360deg); } }
            `}</style>
        </div>
    )
}