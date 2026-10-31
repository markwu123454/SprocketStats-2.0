import { expect, it } from "vitest"
import { taskLeaderboard, type CompletedTask } from "./taskLeaderboard"

it("counts approved tasks once per finisher, excludes pending/deleted users, and shares ranks on ties", () => {
    const task = (id: string, user: string | null, status = "done"): CompletedTask => ({ id, finished_by: user, finished_by_name: user, status })
    const rows = taskLeaderboard([task("1", "Amy"), task("1", "Amy"), task("2", "Amy"), task("3", "Ben"), task("4", "Cal"), task("5", "Ben", "review"), task("6", null), task("7", "Cal", "doing")])
    expect(rows.map(row => [row.name, row.count, row.rank])).toEqual([["Amy", 2, 1], ["Ben", 1, 2], ["Cal", 1, 2]])
    expect(taskLeaderboard([])).toEqual([])
})
