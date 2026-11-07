import { useEffect, useState } from "react"
import { Clock } from "lucide-react"
import Button from "@/components/ui/Button"
import Notice from "@/components/ui/Notice"
import Skeleton from "@/components/ui/Skeleton"
import EmptyState from "@/components/ui/EmptyState"
import { cardClass, typeTitle } from "@/lib/uiClasses"

interface LeaderboardRow {
    user_id: string
    name: string
    total_seconds: number
    is_current_user: boolean
}

function formatSecondsClocked(totalSeconds: number): string {
    const h = Math.floor(totalSeconds / 3600)
    const m = Math.floor((totalSeconds % 3600) / 60)
    return `${h}:${String(m).padStart(2, "0")}`
}

export default function AttendanceLeaderboard() {
    const [rows, setRows] = useState<LeaderboardRow[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(false)
    const [attempt, setAttempt] = useState(0)
    useEffect(() => {
        const controller = new AbortController()
        setLoading(true)
        setError(false)
        fetch(`${import.meta.env.VITE_BACKEND_URL}/attendance/leaderboard`, { credentials: "include", signal: controller.signal })
            .then(response => { if (!response.ok) throw new Error("load"); return response.json() as Promise<LeaderboardRow[]> })
            .then(setRows)
            .catch(() => { if (!controller.signal.aborted) setError(true) })
            .finally(() => { if (!controller.signal.aborted) setLoading(false) })
        return () => controller.abort()
    }, [attempt])
    const maxSeconds = Math.max(1, ...rows.map(row => row.total_seconds))

    return <section className={`${cardClass} theme-bg backdrop-blur-sm`} aria-labelledby="attendance-leaderboard-title">
        <div className="flex items-center gap-2">
            <Clock size={18} className="theme-text-contrast" aria-hidden="true" />
            <h2 id="attendance-leaderboard-title" className={`${typeTitle} theme-text`}>Attendance leaderboard</h2>
        </div>
        {loading ? <div role="status" aria-label="Loading attendance leaderboard" className="flex flex-col gap-3"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
            : error ? <Notice>Couldn't load the leaderboard. <Button variant="text" onClick={() => setAttempt(value => value + 1)}>Try again</Button></Notice>
            : rows.length === 0 ? <EmptyState>No hours logged yet. Time clocked at meetings will appear here.</EmptyState>
            : <ol className="flex flex-col gap-1">
                {rows.map((row, i) => <li key={row.user_id} className="rounded-lg p-3 flex flex-col gap-2"
                    style={row.is_current_user ? { background: "var(--theme-button-bg)" } : undefined}>
                    <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="theme-text min-w-0 break-words"><span className="theme-subtext-color mr-2">{i + 1}</span>{row.name}{row.is_current_user ? " · You" : ""}</span>
                        <span className="font-semibold theme-text shrink-0">{formatSecondsClocked(row.total_seconds)} <span className="theme-subtext-color font-normal">hrs</span></span>
                    </div>
                    <div className="h-1 rounded-full theme-button-bg overflow-hidden" aria-hidden="true">
                        <div className="h-full rounded-full" style={{ width: `${row.total_seconds / maxSeconds * 100}%`, background: "var(--theme-text-contrast)" }} />
                    </div>
                </li>)}
            </ol>}
    </section>
}
