import { expect, it } from "vitest"
import { taskLeaderboard, type CompletedTask } from "./taskLeaderboard"

const task = (id: string, user: string | null, priority = "low", status = "done", contributors: string[] = []): CompletedTask => ({
    id, finished_by: user, finished_by_name: user, status, priority,
    contributors: contributors.map(c => ({ id: c, display_name: c })),
})

it("scores by priority, counts each task once, ignores unfinished/orphaned tasks, and shares ranks on ties", () => {
    const rows = taskLeaderboard([
        task("1", "Amy", "critical"), task("1", "Amy", "critical"), task("2", "Amy", "low"),
        task("3", "Ben", "high"), task("4", "Cal", "med"), task("5", "Cal", "low"),
        task("6", "Ben", "high", "review"), task("7", null), task("8", "Cal", "high", "doing"),
    ])
    expect(rows.map(r => [r.name, r.points, r.count, r.rank])).toEqual([["Amy", 6, 2, 1], ["Cal", 3, 2, 2], ["Ben", 3, 1, 2]])
    expect(taskLeaderboard([])).toEqual([])
})

it("gives contributors half the points rounded up, and never double-credits the finisher", () => {
    const rows = taskLeaderboard([task("1", "Amy", "critical", "done", ["Ben", "Amy"]), task("2", "Ben", "low", "done", ["Cal"])])
    expect(rows.map(r => [r.name, r.points, r.count])).toEqual([["Amy", 5, 1], ["Ben", 4, 1], ["Cal", 1, 0]])
})
