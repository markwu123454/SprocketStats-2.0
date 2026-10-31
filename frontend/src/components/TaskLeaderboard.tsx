import { useEffect, useState } from "react"
import { Trophy } from "lucide-react"
import Button from "@/components/ui/Button"
import Notice from "@/components/ui/Notice"
import Skeleton from "@/components/ui/Skeleton"
import EmptyState from "@/components/ui/EmptyState"
import { useOnboardedUser } from "@/contexts/authContext"
import { cardClass, typeTitle } from "@/lib/uiClasses"
import { taskLeaderboard, type CompletedTask } from "@/lib/taskLeaderboard"

export default function TaskLeaderboard() {
    const user = useOnboardedUser()
    const [tasks, setTasks] = useState<CompletedTask[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(false)
    const [attempt, setAttempt] = useState(0)
    useEffect(() => {
        const controller = new AbortController()
        setLoading(true)
        setError(false)
        fetch(`${import.meta.env.VITE_BACKEND_URL}/tasks`, { credentials: "include", signal: controller.signal })
            .then(response => { if (!response.ok) throw new Error("load"); return response.json() as Promise<CompletedTask[]> })
            .then(setTasks)
            .catch(() => { if (!controller.signal.aborted) setError(true) })
            .finally(() => { if (!controller.signal.aborted) setLoading(false) })
        return () => controller.abort()
    }, [attempt])
    const rows = taskLeaderboard(tasks)

    return <section className={`${cardClass} theme-bg`} aria-labelledby="leaderboard-title">
        <div className="flex items-center gap-2">
            <Trophy size={18} className="theme-text-contrast" aria-hidden="true" />
            <h2 id="leaderboard-title" className={`${typeTitle} theme-text`}>Task leaderboard</h2>
        </div>
        {loading ? <div role="status" aria-label="Loading task leaderboard" className="flex flex-col gap-3"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
            : error ? <Notice>Couldn't load the leaderboard. <Button variant="text" onClick={() => setAttempt(value => value + 1)}>Try again</Button></Notice>
            : rows.length === 0 ? <EmptyState>No completed tasks yet. Approved tasks will appear here.</EmptyState>
            : <ol className="flex flex-col gap-1">
                {rows.map(row => <li key={row.userId} className="rounded-lg p-3 flex flex-col gap-2"
                    style={row.userId === user.id ? { background: "var(--theme-button-bg)" } : undefined}>
                    <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="theme-text min-w-0 break-words"><span className="theme-subtext-color mr-2">{row.rank}</span>{row.name}{row.userId === user.id ? " · You" : ""}</span>
                        <span className="font-semibold theme-text shrink-0">{row.count} {row.count === 1 ? "task" : "tasks"}</span>
                    </div>
                    <div className="h-1 rounded-full theme-button-bg overflow-hidden" aria-hidden="true">
                        <div className="h-full rounded-full" style={{ width: `${row.count / rows[0].count * 100}%`, background: "var(--theme-text-contrast)" }} />
                    </div>
                </li>)}
            </ol>}
    </section>
}
