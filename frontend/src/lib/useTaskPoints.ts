import { useEffect, useMemo } from "react"
import { useBootstrapped } from "@/contexts/bootstrapContext"
import { taskLeaderboard, type CompletedTask } from "./taskLeaderboard"

/**
 * Every member's all-time task points, by user id, or null until the tasks are
 * known. A failed fetch leaves it null (or on the seeded data): callers show a
 * dash, never an error.
 */
export function useTaskPoints(): Map<string, number> | null {
    const [tasks, setTasks] = useBootstrapped<CompletedTask[] | null>("tasks", null)
    useEffect(() => {
        const controller = new AbortController()
        fetch(`${import.meta.env.VITE_BACKEND_URL}/tasks`, { credentials: "include", signal: controller.signal })
            .then(response => { if (!response.ok) throw new Error("load"); return response.json() as Promise<CompletedTask[]> })
            .then(setTasks)
            .catch(() => { /* points stay a dash */ })
        return () => controller.abort()
    }, [setTasks])
    return useMemo(() => tasks === null ? null : new Map(taskLeaderboard(tasks).map(row => [row.userId, row.points])), [tasks])
}
