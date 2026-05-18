import { useAuth } from "@/contexts/authContext.tsx"
import { formatRole } from "@/pages/OnboardingPage.tsx"
import { LogOut, Mail, ShieldCheck } from "lucide-react"

export default function AccountPage() {
    const { user, logout } = useAuth()
    if (!user) return null

    return (
        <div className="max-w-lg mx-auto px-4 py-8 flex flex-col gap-5">
            <h1 className="text-xl font-bold theme-text">Account</h1>

            {/* Profile card */}
            <div
                className="rounded-xl border p-5 flex items-center gap-4"
                style={{ background: "var(--theme-bg)", borderColor: "var(--theme-border)" }}
            >
                <img
                    src={user.picture}
                    alt={user.name}
                    className="w-16 h-16 rounded-full shrink-0"
                    referrerPolicy="no-referrer"
                />
                <div className="min-w-0">
                    <p className="text-lg font-semibold theme-text truncate">{user.display_name ?? user.name}</p>
                    {user.display_name && user.name !== user.display_name && (
                        <p className="text-xs theme-subtext-color truncate">{user.name}</p>
                    )}
                    <div className="flex items-center gap-1.5 mt-1">
                        <Mail size={12} className="theme-subtext-color shrink-0" />
                        <p className="text-sm theme-subtext-color truncate">{user.email}</p>
                    </div>
                    {user.role && (
                        <div className="flex items-center gap-1.5 mt-0.5">
                            <ShieldCheck size={12} className="theme-text-contrast shrink-0 opacity-80" />
                            <p className="text-sm theme-text-contrast opacity-80 truncate">{formatRole(user.role)}</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Sign out */}
            <div
                className="rounded-xl border overflow-hidden"
                style={{ background: "var(--theme-bg)", borderColor: "var(--theme-border)" }}
            >
                <button
                    onClick={() => void logout()}
                    className="w-full flex items-center gap-3 px-5 py-3.5 text-sm font-medium theme-text hover:opacity-80 transition-opacity"
                >
                    <LogOut size={16} />
                    Sign out
                </button>
            </div>
        </div>
    )
}