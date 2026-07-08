import { useAuth, useOnboardedUser } from "@/contexts/authContext.tsx"
import { getPerm } from "@/lib/permissions"
import { LogOut, Mail, ShieldCheck, Palette, Navigation, Bell } from "lucide-react"
import { useEffect, useState } from "react"
import { useTheme } from "@/contexts/themeProvider.tsx"
import Avatar from "@/components/Avatar.tsx"
import { getPushState, subscribeToPush, unsubscribeFromPush, type PushState } from "@/lib/push.ts"

const NAV_TEXT_KEY = "nav-show-text"

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

    useEffect(() => {
        void getPushState().then(setPushState)
    }, [])

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

                    <div style={{ height: "1px", background: "var(--theme-border)" }} />

                    {/* Nav Labels Row */}
                    <div className="flex items-center justify-between px-5 py-3.5 gap-4">
                        <div className="flex items-center gap-3">
                            <Navigation size={16} className="theme-subtext-color shrink-0" />
                            <div>
                                <p className="text-sm font-medium theme-text">Nav labels</p>
                                <p className="text-xs theme-subtext-color">Show text labels on mobile nav</p>
                            </div>
                        </div>
                        <button
                            role="switch"
                            aria-checked={showNavText}
                            onClick={() => setShowNavText(!showNavText)}
                            className="relative shrink-0 w-11 h-6 rounded-full transition-colors duration-200"
                            style={{
                                background: showNavText
                                    ? "var(--theme-button-bg, #3b82f6)"
                                    : "var(--theme-border)",
                            }}
                        >
                            <span
                                className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200"
                                style={{ transform: showNavText ? "translateX(20px)" : "translateX(0)" }}
                            />
                        </button>
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
                                            : "Get notified about new notices on this device"}
                                </p>
                            </div>
                        </div>
                        <button
                            role="switch"
                            aria-checked={pushState === "subscribed"}
                            disabled={pushBusy || pushState === "unsupported" || pushState === "denied"}
                            onClick={() => void togglePush()}
                            className="relative shrink-0 w-11 h-6 rounded-full transition-colors duration-200 disabled:opacity-40"
                            style={{
                                background: pushState === "subscribed"
                                    ? "var(--theme-button-bg, #3b82f6)"
                                    : "var(--theme-border)",
                            }}
                        >
                            <span
                                className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200"
                                style={{ transform: pushState === "subscribed" ? "translateX(20px)" : "translateX(0)" }}
                            />
                        </button>
                    </div>

                    {pushError && (
                        <p className="px-5 pb-3.5 text-xs text-red-500">{pushError}</p>
                    )}
                </div>
            </section>
        </div>
    )
}
