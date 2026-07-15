import { Link, Navigate } from "react-router-dom"
import { ChevronRight, ShieldAlert } from "lucide-react"
import { useOnboardedUser } from "@/contexts/authContext"
import { visibleSections } from "@/lib/controlSections"
import { useIsMobile } from "@/lib/useIsMobile"

/**
 * Control Panel landing (`/control`).
 *
 * The set of sub-pages a user can reach is role-dependent, so both the desktop
 * sidebar accordion and this hub filter `CONTROL_SECTIONS` by the same perm
 * check. Behaviour splits by viewport:
 *   • Desktop — the sidebar already lists the sections, so land the user on the
 *     first available one instead of an empty landing page.
 *   • Mobile — there's no sidebar, so show a tappable card per section.
 * If the role somehow has `control_panel.view` but no sections, show an empty
 * state rather than redirect-looping.
 */
export default function ControlPanelHub() {
    const user = useOnboardedUser()
    const isMobile = useIsMobile()

    const sections = visibleSections(user.permissions)

    if (sections.length === 0) {
        return (
            <div className="max-w-4xl mx-auto px-4 py-6 flex flex-col gap-6">
                <h1 className="text-2xl font-bold theme-h1-color">Control Panel</h1>
                <div
                    className="rounded-xl border p-8 flex flex-col items-center justify-center gap-3 min-h-48 text-center backdrop-blur-sm"
                    style={{ background: "var(--theme-bg)", borderColor: "var(--theme-border)" }}
                >
                    <ShieldAlert size={32} className="theme-text-contrast opacity-60" />
                    <p className="text-base font-medium theme-text">Nothing here yet</p>
                    <p className="text-sm theme-subtext-color max-w-xs">
                        Your role doesn't have access to any Control Panel sections.
                    </p>
                </div>
            </div>
        )
    }

    // Desktop: sidebar handles navigation — skip the hub, open the first section.
    if (!isMobile) return <Navigate to={sections[0].to} replace />

    return (
        <div className="max-w-4xl mx-auto px-4 py-6 flex flex-col gap-6">
            <h1 className="text-2xl font-bold theme-h1-color">Control Panel</h1>
            <div className="flex flex-col gap-3">
                {sections.map(({ to, label, icon: Icon }) => (
                    <Link
                        key={to}
                        to={to}
                        className="flex items-center gap-4 rounded-xl border p-4 backdrop-blur-sm hover:opacity-90 transition-opacity"
                        style={{ background: "var(--theme-bg)", borderColor: "var(--theme-border)" }}
                    >
                        <div className="flex items-center justify-center w-10 h-10 rounded-lg shrink-0"
                             style={{ background: "color-mix(in oklch, var(--theme-button-bg) 18%, transparent)" }}>
                            <Icon size={20} className="theme-text-contrast" />
                        </div>
                        <span className="flex-1 text-base font-medium theme-text">{label}</span>
                        <ChevronRight size={18} className="theme-text opacity-40" />
                    </Link>
                ))}
            </div>
        </div>
    )
}
