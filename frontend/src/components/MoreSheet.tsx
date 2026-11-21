import { Link, useLocation } from "react-router-dom"
import { ChevronRight, LogOut, Settings } from "lucide-react"
import AccountSummary from "@/components/AccountSummary"
import Avatar from "@/components/Avatar"
import Sheet from "@/components/ui/Sheet"
import { useAuth, useOnboardedUser } from "@/contexts/authContext"
import { visibleSections } from "@/lib/controlSections"
import { moreTabs } from "@/lib/navTabs"
import { can } from "@/lib/permissions"
import { focusRing, menuRowClass, navActiveTint as activeTint } from "@/lib/uiClasses"

const sectionHeading = "px-3 pt-4 pb-1.5 text-xs font-bold uppercase tracking-wider theme-subtext-color"

/**
 * The mobile More menu: the signed-in account, the pages that don't fit in the
 * 5-tab bar, and the Control Panel pages this role can open, each one tap away.
 * The bar's More tab and the avatar in the top bar both open it. Desktop never
 * shows it: the sidebar and the account dropdown cover the same ground.
 *
 * It uses the taller form height rather than the 60% menu cap (modals.md):
 * it is the app's navigation, so every destination should show without scrolling.
 */
export default function MoreSheet({ onClose }: { onClose: () => void }) {
    const { logout } = useAuth()
    const user = useOnboardedUser()
    const { pathname } = useLocation()

    const pages = moreTabs(user.permissions)
    const manage = can(user.permissions, "control_panel.view") ? visibleSections(user.permissions) : []
    const isCurrent = (to: string) => pathname === to || pathname.startsWith(to + "/")

    return (
        <Sheet title="Menu" kind="form" labelledByTitleHidden onClose={onClose} className="px-2 pt-3 pb-2">
            <div className="px-3 pb-3 border-b theme-border flex items-center gap-3">
                <Avatar name={user.name} picture={user.picture} size={40} />
                <AccountSummary className="flex-1" />
                <Link
                    to="/settings"
                    onClick={onClose}
                    aria-label="Settings"
                    aria-current={isCurrent("/settings") ? "page" : undefined}
                    className={`shrink-0 flex items-center justify-center w-12 h-12 rounded-lg ${isCurrent("/settings") ? "theme-text-contrast" : "theme-text"} ${focusRing}`}
                    style={isCurrent("/settings") ? activeTint : undefined}
                >
                    <Settings size={20} />
                </Link>
            </div>

            {pages.length > 0 && (
                <nav aria-label="Pages">
                    <h3 className={sectionHeading}>Pages</h3>
                    <div className="grid grid-cols-2 gap-2 px-1">
                        {pages.map(({ to, label, icon: Icon }) => {
                            const current = isCurrent(to)
                            return (
                                <Link
                                    key={to}
                                    to={to}
                                    onClick={onClose}
                                    aria-current={current ? "page" : undefined}
                                    className={`flex flex-col justify-between gap-3 min-h-18 p-3 rounded-xl border theme-border ${focusRing}`}
                                    style={current ? activeTint : undefined}
                                >
                                    <Icon size={21} className="theme-text-contrast" />
                                    <span className={`text-sm font-medium ${current ? "theme-text-contrast" : "theme-text"}`}>{label}</span>
                                </Link>
                            )
                        })}
                    </div>
                </nav>
            )}

            {manage.length > 0 && (
                <nav aria-label="Manage">
                    <h3 className={sectionHeading}>Manage</h3>
                    <ul className="flex flex-col">
                        {manage.map(({ to, label, icon: Icon }) => {
                            const href = `/control/${to}`
                            const current = isCurrent(href)
                            return (
                                <li key={to}>
                                    <Link
                                        to={href}
                                        onClick={onClose}
                                        aria-current={current ? "page" : undefined}
                                        className={`${menuRowClass} ${current ? "theme-text-contrast" : "theme-text"}`}
                                        style={current ? activeTint : undefined}
                                    >
                                        <span className="flex items-center gap-3 min-w-0">
                                            <Icon size={18} className="shrink-0 theme-text-contrast" />
                                            <span className="truncate">{label}</span>
                                        </span>
                                        <ChevronRight size={16} className="shrink-0 opacity-40" />
                                    </Link>
                                </li>
                            )
                        })}
                    </ul>
                </nav>
            )}

            <div className="my-1 mt-2 border-t theme-border" role="separator" />
            <button
                type="button"
                onClick={() => { onClose(); void logout() }}
                className={`${menuRowClass} justify-start theme-danger`}
            >
                <LogOut size={18} />
                Sign out
            </button>
        </Sheet>
    )
}
