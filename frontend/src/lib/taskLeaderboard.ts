export interface CompletedTask {
    id: string
    status: string
    finished_by: string | null
    finished_by_name: string | null
}

export function taskLeaderboard(tasks: CompletedTask[]) {
    const totals = new Map<string, { userId: string, name: string, count: number }>()
    const seen = new Set<string>()
    for (const task of tasks) {
        if (task.status !== "done" || !task.finished_by || seen.has(task.id)) continue
        seen.add(task.id)
        const row = totals.get(task.finished_by) ?? { userId: task.finished_by, name: task.finished_by_name || "Team member", count: 0 }
        row.count++
        totals.set(row.userId, row)
    }
    return [...totals.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId))
        .map((row, _index, rows) => ({ ...row, rank: rows.findIndex(other => other.count === row.count) + 1 }))
}
