import { useAuth, useOnboardedUser } from "@/contexts/authContext"
import { getPerm } from "@/lib/permissions"
import { LogOut, Mail, ShieldCheck, Palette, Navigation, Bell, ListChecks, CalendarClock, Milestone, Megaphone } from "lucide-react"
import { useEffect, useState } from "react"
import { useTheme } from "@/contexts/themeContext"
import Avatar from "@/components/Avatar.tsx"
import {
    getPushPreferences, getPushState, setPushPreferences, subscribeToPush, syncPushSubscription,
    unsubscribeFromPush, type PushCategory, type PushPreferences, type PushState,
} from "@/lib/push.ts"

const NAV_TEXT_KEY = "nav-show-text"

const PUSH_CATEGORY_ROWS: { key: PushCategory; label: string; description: string; icon: typeof Bell }[] = [
    { key: "task_assigned",    label: "Task assignments",   description: "When someone assigns you a task or adds you to one", icon: ListChecks },
    { key: "meeting_reminder", label: "Meeting reminders",  description: "A day before each team meeting",                    icon: CalendarClock },
    { key: "event_reminder",   label: "Competition events", description: "The evening before and morning of each event",      icon: Milestone },
]

function Switch({ checked, disabled, onClick, label }: {
    checked: boolean
    disabled?: boolean
    onClick: () => void
    label?: string
}) {
    return (
        <button
            role="switch"
            aria-checked={checked}
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
            className="relative shrink-0 w-11 h-6 rounded-full transition-colors duration-200 disabled:opacity-40"
            style={{
                background: checked
                    ? "var(--theme-button-bg, #3b82f6)"
                    : "var(--theme-border)",
            }}
        >
            <span
                className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200"
                style={{ transform: checked ? "translateX(20px)" : "translateX(0)" }}
            />
        </button>
    )
}

const Divider = () => <div style={{ height: "1px", background: "var(--theme-border)" }} />

function getNavTextPref(): boolean {
    const stored = localStorage.getItem(NAV_TEXT_KEY)
    return stored === null ? true : stored === "true"
}

export default function SettingPage() {
    const { logout } = useAuth()
    const user = useOnboardedUser()
    const { theme, setTheme } = useTheme()
    const [showNavText, setShowNavTextState] = useState<boolean>(getNavTextPref)
    const [pushState, setPushState] = useState<PushState>("unsubscribed")
    const [pushBusy, setPushBusy] = useState(false)
    const [pushError, setPushError] = useState<string | null>(null)
    const [prefs, setPrefs] = useState<PushPreferences | null>(null)
    const [prefsError, setPrefsError] = useState<string | null>(null)

    useEffect(() => {
        // Not just getPushState(): this also re-registers the subscription with
        // the backend, so "on" here means the server will actually send to it.
        void syncPushSubscription().then(setPushState)
        getPushPreferences().then(setPrefs).catch(() => setPrefsError("Couldn't load notification preferences"))
    }, [])

    async function toggleCategory(key: PushCategory) {
        if (!prefs) return
        const previous = prefs
        setPrefs({ ...prefs, [key]: !prefs[key] })
        setPrefsError(null)
        try {
            setPrefs(await setPushPreferences({ [key]: !previous[key] }))
        } catch (e) {
            setPrefs(previous)
            setPrefsError(e instanceof Error ? e.message : "Something went wrong")
        }
    }

    function setShowNavText(v: boolean) {
        setShowNavTextState(v)
        localStorage.setItem(NAV_TEXT_KEY, String(v))
        window.dispatchEvent(new CustomEvent("nav-prefs-change", { detail: { showNavText: v } }))
    }

    async function togglePush() {
        setPushBusy(true)
        setPushError(null)
        try {
            if (pushState === "subscribed") {
                await unsubscribeFromPush()
                setPushState("unsubscribed")
            } else {
                await subscribeToPush()
                setPushState("subscribed")
            }
        } catch (e) {
            setPushError(e instanceof Error ? e.message : "Something went wrong")
            setPushState(await getPushState())
        } finally {
            setPushBusy(false)
        }
    }

    const activeYear = theme.replace("theme-", "") as "2025" | "2026" | "2027"

    return (
        <div className="max-w-lg mx-auto px-4 py-8 flex flex-col gap-8">
            <h1 className="text-xl font-bold theme-text">Settings</h1>

            {/* Account Section */}
            <section className="flex flex-col gap-3">
                <h2 className="text-xs font-semibold uppercase tracking-widest theme-subtext-color px-1">Account</h2>

                <div
                    className="rounded-xl border p-5 flex items-center gap-4"
                    style={{ background: "var(--theme-bg)", borderColor: "var(--theme-border)" }}
                >
                    <Avatar name={user.name} picture={user.picture} size={64} />
                    <div className="min-w-0">
                        <p className="text-lg font-semibold theme-text truncate">{user.display_name}</p>
                        {user.name !== user.display_name && (
                            <p className="text-xs theme-subtext-color truncate">{user.name}</p>
                        )}
                        <div className="flex items-center gap-1.5 mt-1">
                            <Mail size={12} className="theme-subtext-color shrink-0" />
                            <p className="text-sm theme-subtext-color truncate">{user.email}</p>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                            <ShieldCheck size={12} className="theme-text-contrast shrink-0 opacity-80" />
                            <p className="text-sm theme-text-contrast opacity-80 truncate">
                                {(getPerm(user.permissions, "label") as string | undefined) ?? user.role}
                            </p>
                        </div>
                    </div>
                </div>

                <div
                    className="rounded-xl border overflow-hidden"
                    style={{ background: "var(--theme-bg)", borderColor: "var(--theme-border)" }}
                >
                    <button
                        onClick={() => void logout()}
                        className="w-full flex items-center gap-3 px-5 py-3.5 text-sm font-medium text-red-500 hover:opacity-80 transition-opacity"
                    >
                        <LogOut size={16} />
                        Sign out
                    </button>
                </div>
            </section>

            {/* Appearance Section */}
            <section className="flex flex-col gap-3">
                <h2 className="text-xs font-semibold uppercase tracking-widest theme-subtext-color px-1">Appearance</h2>

                <div
                    className="rounded-xl border overflow-hidden"
                    style={{ background: "var(--theme-bg)", borderColor: "var(--theme-border)" }}
                >
                    {/* Theme Row */}
                    <div className="flex items-center justify-between px-5 py-3.5 gap-4">
                        <div className="flex items-center gap-3">
                            <Palette size={16} className="theme-subtext-color shrink-0" />
                            <div>
                                <p className="text-sm font-medium theme-text">Theme</p>
                                <p className="text-xs theme-subtext-color">Choose your visual style</p>
                            </div>
                        </div>
                        <div
                            className="flex items-center gap-1 rounded-lg p-1"
                            style={{ background: "color-mix(in oklch, var(--theme-border) 60%, transparent)" }}
                        >
                            {(["2025", "2026", "2027"] as const).map((year) => (
                                <button
                                    key={year}
                                    onClick={() => setTheme(`theme-${year}`)}
                                    className="px-3 py-1 rounded-md text-xs font-medium transition-all"
                                    style={
                                        activeYear === year
                                            ? {
                                                background: "var(--theme-bg)",
                                                color: "var(--theme-text)",
                                                boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
                                            }
                                            : { color: "var(--theme-text)", opacity: 0.5 }
                                    }
                                >
                                    {year}
                                </button>
                            ))}
                        </div>
                    </div>

                    <Divider />

                    {/* Nav Labels Row */}
                    <div className="flex items-center justify-between px-5 py-3.5 gap-4">
                        <div className="flex items-center gap-3">
                            <Navigation size={16} className="theme-subtext-color shrink-0" />
                            <div>
                                <p className="text-sm font-medium theme-text">Nav labels</p>
                                <p className="text-xs theme-subtext-color">Show text labels on mobile nav</p>
                            </div>
                        </div>
                        <Switch label="Nav labels" checked={showNavText} onClick={() => setShowNavText(!showNavText)} />
                    </div>
                </div>
            </section>

            {/* Notifications Section */}
            <section className="flex flex-col gap-3">
                <h2 className="text-xs font-semibold uppercase tracking-widest theme-subtext-color px-1">Notifications</h2>

                <div
                    className="rounded-xl border overflow-hidden"
                    style={{ background: "var(--theme-bg)", borderColor: "var(--theme-border)" }}
                >
                    <div className="flex items-center justify-between px-5 py-3.5 gap-4">
                        <div className="flex items-center gap-3">
                            <Bell size={16} className="theme-subtext-color shrink-0" />
                            <div>
                                <p className="text-sm font-medium theme-text">Push notifications</p>
                                <p className="text-xs theme-subtext-color">
                                    {pushState === "unsupported"
                                        ? "Not supported in this browser"
                                        : pushState === "denied"
                                            ? "Blocked - enable in your browser's site settings"
                                            : "Get notified on this device"}
                                </p>
                            </div>
                        </div>
                        <Switch
                            label="Push notifications"
                            checked={pushState === "subscribed"}
                            disabled={pushBusy || pushState === "unsupported" || pushState === "denied"}
                            onClick={() => void togglePush()}
                        />
                    </div>

                    {pushError && (
                        <p className="px-5 pb-3.5 text-xs text-red-500">{pushError}</p>
                    )}

                    {pushState === "subscribed" && (
                        <>
                            <Divider />
                            <div className="flex items-center gap-3 px-5 py-3.5">
                                <Megaphone size={16} className="theme-subtext-color shrink-0" />
                                <div>
                                    <p className="text-sm font-medium theme-text">Team announcements</p>
                                    <p className="text-xs theme-subtext-color">Always on while push is enabled</p>
                                </div>
                            </div>
                            {PUSH_CATEGORY_ROWS.map(({ key, label, description, icon: Icon }) => (
                                <div key={key}>
                                    <Divider />
                                    <div className="flex items-center justify-between px-5 py-3.5 gap-4">
                                        <div className="flex items-center gap-3">
                                            <Icon size={16} className="theme-subtext-color shrink-0" />
                                            <div>
                                                <p className="text-sm font-medium theme-text">{label}</p>
                                                <p className="text-xs theme-subtext-color">{description}</p>
                                            </div>
                                        </div>
                                        <Switch
                                            label={label}
                                            checked={prefs?.[key] ?? true}
                                            disabled={!prefs}
                                            onClick={() => void toggleCategory(key)}
                                        />
                                    </div>
                                </div>
                            ))}
                            {prefsError && (
                                <p className="px-5 pb-3.5 text-xs text-red-500">{prefsError}</p>
                            )}
                        </>
                    )}
                </div>
                {pushState === "subscribed" && (
                    <p className="text-xs theme-subtext-color px-1">
                        These choices apply to every device you've turned push on for.
                    </p>
                )}
            </section>
        </div>
    )
}
