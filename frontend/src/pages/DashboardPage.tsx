import { useAuth } from "@/contexts/authContext.tsx"
import { BarChart3, Users, Trophy, Activity } from "lucide-react"

const statCards = [
    { label: "Matches Scouted", value: "—", icon: BarChart3, description: "Total matches recorded" },
    { label: "Teams Tracked", value: "—", icon: Users, description: "Teams in database" },
    { label: "Events", value: "—", icon: Trophy, description: "Events this season" },
    { label: "Active Scouts", value: "—", icon: Activity, description: "Members online now" },
]

export default function DashboardPage() {
    const { user } = useAuth()

    return (
        <div className="max-w-7xl mx-auto px-4 py-8 flex flex-col gap-8">
            {/* Header */}
            <div className="flex items-center gap-4">
                {user?.picture && (
                    <img
                        src={user.picture}
                        alt={user.name}
                        className="w-12 h-12 rounded-full ring-2"
                        style={{ ringColor: "var(--theme-border)" }}
                        referrerPolicy="no-referrer"
                    />
                )}
                <div>
                    <h1 className="text-2xl font-bold theme-text">
                        Welcome back, {user?.given_name ?? "Scout"}
                    </h1>
                    <p className="text-sm theme-subtext-color">Here's your scouting overview</p>
                </div>
            </div>

            {/* Stat cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {statCards.map(({ label, value, icon: Icon, description }) => (
                    <div
                        key={label}
                        className="rounded-xl border p-5 flex flex-col gap-3 backdrop-blur-sm"
                        style={{ background: "var(--theme-bg)", borderColor: "var(--theme-border)" }}
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium theme-text opacity-70">{label}</span>
                            <Icon size={18} className="theme-text-contrast opacity-80" />
                        </div>
                        <p className="text-3xl font-bold theme-text">{value}</p>
                        <p className="text-xs theme-subtext-color">{description}</p>
                    </div>
                ))}
            </div>

            {/* Placeholder content area */}
            <div
                className="rounded-xl border p-8 flex flex-col items-center justify-center gap-3 min-h-48 text-center backdrop-blur-sm"
                style={{ background: "var(--theme-bg)", borderColor: "var(--theme-border)" }}
            >
                <BarChart3 size={32} className="theme-text-contrast opacity-60" />
                <p className="text-base font-medium theme-text">No data yet</p>
                <p className="text-sm theme-subtext-color max-w-xs">
                    Start scouting matches to see analytics and team performance data here.
                </p>
            </div>
        </div>
    )
}