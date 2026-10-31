import { useAuth, useOnboardedUser } from "@/contexts/authContext"
import { getPerm } from "@/lib/permissions"
import { LogOut, Mail, ShieldCheck, Palette, Navigation, Bell, ListChecks, CalendarClock, Milestone, Megaphone, Pencil } from "lucide-react"
import { useEffect, useState } from "react"
import { useTheme } from "@/contexts/themeContext"
import Avatar from "@/components/Avatar.tsx"
import Button from "@/components/ui/Button"
import Toggle from "@/components/ui/Toggle"
import { useDiscardGuard } from "@/lib/useDiscardGuard"
import { fieldErrorClass, focusRing, helperClass, inputClass, typeH1, typeH2 } from "@/lib/uiClasses"
import {
    getPushPreferences, getPushState, setPushPreferences, subscribeToPush, syncPushSubscription,
    unsubscribeFromPush, type PushCategory, type PushPreferences, type PushState,
} from "@/lib/push.ts"

const NAV_TEXT_KEY = "nav-show-text"

const API = import.meta.env.VITE_BACKEND_URL

const PUSH_CATEGORY_ROWS: { key: PushCategory; label: string; description: string; icon: typeof Bell }[] = [
    { key: "task_assigned",    label: "Task assignments",   description: "When someone assigns you a task or adds you to one", icon: ListChecks },
    { key: "meeting_reminder", label: "Meeting reminders",  description: "A day before each team meeting",                    icon: CalendarClock },
    { key: "event_reminder",   label: "Competition events", description: "The evening before and morning of each event",      icon: Milestone },
]

function getNavTextPref(): boolean {
    const stored = localStorage.getItem(NAV_TEXT_KEY)
    return stored === null ? true : stored === "true"
}

export default function SettingPage() {
    const { logout, refreshUser } = useAuth()
    const user = useOnboardedUser()
    const [editingName, setEditingName] = useState(false)
    const [nameDraft, setNameDraft] = useState("")
    const [nameSaving, setNameSaving] = useState(false)
    const [nameError, setNameError] = useState<string | null>(null)
    // Dirty while the inline name field holds something other than the saved name.
    const confirmDiscard = useDiscardGuard(editingName && nameDraft !== user.display_name)
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
            setPrefsError(e instanceof Error ? e.message : "Couldn't save notification preferences")
        }
    }

    function startEditingName() {
        setNameDraft(user.display_name)
        setNameError(null)
        setEditingName(true)
    }

    async function saveName() {
        const trimmed = nameDraft.trim()
        if (!trimmed) {
            setNameError("Name cannot be empty")
            return
        }
        if (trimmed === user.display_name) {
            setEditingName(false)
            return
        }
        setNameSaving(true)
        setNameError(null)
        try {
            const res = await fetch(`${API}/auth/display-name`, {
                method: "PATCH",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ display_name: trimmed }),
            })
            if (!res.ok) {
                const data = await res.json().catch(() => ({}))
                // Pydantic validation errors come back as a list of {msg}.
                const detail = Array.isArray(data?.detail) ? data.detail[0]?.msg : data?.detail
                throw new Error(detail ?? "Couldn't save your name")
            }
            await refreshUser()
            setEditingName(false)
        } catch (e) {
            setNameError(e instanceof Error ? e.message : "Couldn't save your name")
        } finally {
            setNameSaving(false)
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
            setPushError(e instanceof Error ? e.message : "Couldn't change push notifications")
            setPushState(await getPushState())
        } finally {
            setPushBusy(false)
        }
    }

    const activeYear = theme.replace("theme-", "") as "2025" | "2026" | "2027"

    return (
        <div className="max-w-lg mx-auto px-4 py-8 flex flex-col gap-8">
            <h1 className={`${typeH1} theme-h1-color`}>Settings</h1>

            {/* Account Section */}
            <section className="rounded-xl border theme-border theme-bg overflow-hidden divide-y divide-[var(--theme-border)]">
                <h2 className={`${typeH2} theme-subtext-color px-4 py-3`}>Account</h2>

                <div
                    className="p-5 flex items-center gap-4"
                >
                    <Avatar name={user.name} picture={user.picture} size={64} />
                    <div className="min-w-0 flex-1">
                        {editingName ? (
                            <div className="flex flex-col gap-1.5">
                                <div className="flex flex-wrap items-center gap-2">
                                    <input
                                        autoFocus
                                        value={nameDraft}
                                        maxLength={64}
                                        disabled={nameSaving}
                                        aria-label="Display name"
                                        onChange={e => setNameDraft(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key === "Enter") void saveName()
                                            if (e.key === "Escape") void confirmDiscard().then(ok => { if (ok) setEditingName(false) })
                                        }}
                                        className={`min-w-0 flex-1 ${inputClass}`}
                                    />
                                    <Button
                                        onClick={() => void saveName()}
                                        disabled={nameSaving}
                                        className="px-3"
                                    >
                                        {nameSaving ? "Saving…" : "Save"}
                                    </Button>
                                    <Button
                                        variant="outlined"
                                        onClick={() => void confirmDiscard().then(ok => { if (ok) setEditingName(false) })}
                                        disabled={nameSaving}
                                        className="px-3"
                                    >
                                        Cancel
                                    </Button>
                                </div>
                                {nameError && <p className={fieldErrorClass}>{nameError}</p>}
                            </div>
                        ) : (
                            <div className="flex items-center gap-2 min-w-0">
                                <p className="text-lg font-semibold theme-text truncate">{user.display_name}</p>
                                <Button
                                    variant="icon"
                                    onClick={startEditingName}
                                    aria-label="Edit display name"
                                    title="Edit display name"
                                    className="shrink-0 -my-2"
                                >
                                    <Pencil size={14} />
                                </Button>
                            </div>
                        )}
                        {user.name !== user.display_name && (
                            <p className="text-xs theme-subtext-color truncate">{user.name}</p>
                        )}
                        <div className="flex items-center gap-1.5 mt-1">
                            <Mail size={14} className="theme-subtext-color shrink-0" />
                            <p className="text-sm theme-subtext-color truncate">{user.email}</p>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                            <ShieldCheck size={14} className="theme-text-contrast shrink-0 opacity-80" />
                            <p className="text-sm theme-text-contrast opacity-80 truncate">
                                {(getPerm(user.permissions, "label") as string | undefined) ?? user.role}
                            </p>
                        </div>
                    </div>
                </div>

                <Button
                    variant="danger"
                    onClick={() => void logout()}
                    className="w-full justify-start gap-3 px-4 rounded-none"
                >
                    <LogOut size={16} />
                    Sign out
                </Button>
            </section>

            {/* Appearance Section */}
            <section className="rounded-xl border theme-border theme-bg overflow-hidden divide-y divide-[var(--theme-border)]">
                <h2 className={`${typeH2} theme-subtext-color px-4 py-3`}>Appearance</h2>

                <div className="divide-y divide-[var(--theme-border)]">
                    {/* Theme Row */}
                    <div className="flex flex-wrap items-center justify-between px-4 py-3 gap-x-4 gap-y-3">
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
                                    aria-pressed={activeYear === year}
                                    className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${focusRing}`}
                                    style={
                                        activeYear === year
                                            ? {
                                                background: "var(--theme-bg)",
                                                color: "var(--theme-text)",
                                                boxShadow: "0 0 0 1px var(--theme-outline)",
                                            }
                                            : { color: "var(--theme-text)", opacity: 0.5 }
                                    }
                                >
                                    {year}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Nav Labels Row */}
                    <div className="flex items-center justify-between px-4 py-3 gap-4">
                        <div className="flex items-center gap-3">
                            <Navigation size={16} className="theme-subtext-color shrink-0" />
                            <div>
                                <p className="text-sm font-medium theme-text">Nav labels</p>
                                <p className="text-xs theme-subtext-color">Show text labels on mobile nav</p>
                            </div>
                        </div>
                        <Toggle aria-label="Nav labels" checked={showNavText} onChange={setShowNavText} />
                    </div>
                </div>
            </section>

            {/* Notifications Section */}
            <section className="rounded-xl border theme-border theme-bg overflow-hidden divide-y divide-[var(--theme-border)]">
                <h2 className={`${typeH2} theme-subtext-color px-4 py-3`}>Notifications</h2>

                <div className="divide-y divide-[var(--theme-border)]">
                    <div className="flex items-center justify-between px-4 py-3 gap-4">
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
                        <Toggle
                            aria-label="Push notifications"
                            checked={pushState === "subscribed"}
                            disabled={pushBusy || pushState === "unsupported" || pushState === "denied"}
                            onChange={() => void togglePush()}
                        />
                    </div>

                    {pushError && (
                        <p className={`px-4 py-3 ${fieldErrorClass}`}>{pushError}</p>
                    )}

                    {pushState === "subscribed" && (
                        <>
                            <div className="flex items-center gap-3 px-4 py-3">
                                <Megaphone size={16} className="theme-subtext-color shrink-0" />
                                <div>
                                    <p className="text-sm font-medium theme-text">Team announcements</p>
                                    <p className="text-xs theme-subtext-color">Always on while push is enabled</p>
                                </div>
                            </div>
                            {PUSH_CATEGORY_ROWS.map(({ key, label, description, icon: Icon }) => (
                                <div key={key} className="flex items-center justify-between px-4 py-3 gap-4">
                                    <div className="flex items-center gap-3">
                                        <Icon size={16} className="theme-subtext-color shrink-0" />
                                        <div>
                                            <p className="text-sm font-medium theme-text">{label}</p>
                                            <p className="text-xs theme-subtext-color">{description}</p>
                                        </div>
                                    </div>
                                    <Toggle
                                        aria-label={label}
                                        checked={prefs?.[key] ?? true}
                                        disabled={!prefs}
                                        onChange={() => void toggleCategory(key)}
                                    />
                                </div>
                            ))}
                            {prefsError && (
                                <p className={`px-4 py-3 ${fieldErrorClass}`}>{prefsError}</p>
                            )}
                        </>
                    )}
                </div>
                {pushState === "subscribed" && (
                    <p className={`${helperClass} px-4 py-3`}>
                        These choices apply to every device you've turned push on for.
                    </p>
                )}
            </section>
        </div>
    )
}
