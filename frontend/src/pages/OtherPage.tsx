import { Link, Navigate } from "react-router-dom"
import { ChevronRight } from "lucide-react"
import { useOnboardedUser } from "@/contexts/authContext"
import { otherPages } from "@/lib/navTabs"
import { useIsMobile } from "@/lib/useIsMobile"
import { focusRing } from "@/lib/uiClasses"

/**
 * Mobile overflow destination (`/other`): a card per page that doesn't fit in the
 * 5-tab bottom bar, same pattern as the Control Panel hub. Desktop's sidebar
 * already lists every page, so it just lands on the dashboard.
 */
export default function OtherPage() {
    const user = useOnboardedUser()
    const isMobile = useIsMobile()

    if (!isMobile) return <Navigate to="/dashboard" replace />

    return (
        <div className="max-w-4xl mx-auto px-4 py-6 flex flex-col gap-6">
            <h1 className="text-2xl font-bold theme-h1-color">Other</h1>
            <div className="flex flex-col gap-3">
                {otherPages(user.permissions).map(({ to, label, icon: Icon }) => (
                    <Link
                        key={to}
                        to={to}
                        className={`flex items-center gap-4 rounded-xl border p-4 backdrop-blur-sm hover:opacity-90 transition-opacity theme-bg theme-border ${focusRing}`}
                    >
                        <div className="flex items-center justify-center w-10 h-10 rounded-lg shrink-0"
                             style={{ background: "color-mix(in oklch, var(--theme-button-bg) 18%, transparent)" }}>
                            <Icon size={21} className="theme-text-contrast" />
                        </div>
                        <span className="flex-1 text-base font-medium theme-text">{label}</span>
                        <ChevronRight size={18} className="theme-text opacity-40" />
                    </Link>
                ))}
            </div>
        </div>
    )
}
