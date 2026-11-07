export interface CompletedTask {
    id: string
    status: string
    priority?: string
    finished_by: string | null
    finished_by_name: string | null
    contributors?: { id: string, display_name: string }[]
}

/** Points the person who finishes (gets approval for) a task earns, by priority. */
export const PRIORITY_POINTS: Record<string, number> = { low: 1, med: 2, high: 3, critical: 5 }

/** Contributors earn half the finisher's points, rounded up: helping is never
 *  worth nothing, but it never outscores the person who carried it over the line. */
export function contributorPoints(finisherPoints: number) {
    return Math.ceil(finisherPoints / 2)
}

export function taskLeaderboard(tasks: CompletedTask[]) {
    const totals = new Map<string, { userId: string, name: string, count: number, points: number }>()
    const seen = new Set<string>()
    const credit = (userId: string, name: string | null, points: number, finished: boolean) => {
        const row = totals.get(userId) ?? { userId, name: name || "Team member", count: 0, points: 0 }
        if (finished) row.count++
        row.points += points
        totals.set(userId, row)
    }
    for (const task of tasks) {
        if (task.status !== "done" || !task.finished_by || seen.has(task.id)) continue
        seen.add(task.id)
        const points = PRIORITY_POINTS[task.priority ?? ""] ?? 1
        credit(task.finished_by, task.finished_by_name, points, true)
        for (const c of task.contributors ?? []) {
            if (c.id !== task.finished_by) credit(c.id, c.display_name, contributorPoints(points), false)
        }
    }
    return [...totals.values()].sort((a, b) => b.points - a.points || b.count - a.count || a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId))
        .map((row, _index, rows) => ({ ...row, rank: rows.findIndex(other => other.points === row.points) + 1 }))
}
