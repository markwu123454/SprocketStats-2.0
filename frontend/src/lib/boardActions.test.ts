import { expect, it } from "vitest"
import { boardActions } from "./boardActions"
import type { Acting } from "./boardApi"
import type { Task } from "./tasksApi"

const task = (overrides: Partial<Task> = {}): Task => ({
    id: "t1", title: "Cut the base plate", area: "Drivetrain", bucket: "manufacturing", priority: "med", status: "todo",
    assignee_id: null, assignee_name: null, assignee_picture: null, due_date: null, event_key: null,
    created_by: "lead", created_by_name: "Lead", finished_by: null, finished_by_name: null,
    reviewed_by: null, reviewed_by_name: null, created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z",
    contributors: [], note_count: 0,
    ...overrides,
})

const acting = (overrides: Partial<Acting> = {}): Acting => ({
    token: "t", expires_in: 300, level: "email", user_id: "ava", name: "Ava Chen", first_name: "Ava",
    picture: null, authority: false,
    ...overrides,
})

it("offers nothing until someone identifies, and nothing on a done task", () => {
    expect(boardActions(task(), null)).toEqual([])
    expect(boardActions(task({ status: "done", assignee_id: "ava" }), acting())).toEqual([])
})

it("lets anyone claim an unclaimed task, without moving it", () => {
    expect(boardActions(task(), acting())).toEqual(["claim"])
    expect(boardActions(task(), acting({ level: "code", authority: true }))).toEqual(["claim"])
})

it("moves a task you're on, and lets you leave it", () => {
    const mine = task({ status: "doing", assignee_id: "ava" })
    expect(boardActions(mine, acting())).toEqual(["todo", "review", "leave"])
    const joined = task({ status: "doing", assignee_id: "ben", contributors: [{ id: "ava", display_name: "Ava Chen" }] })
    expect(boardActions(joined, acting())).toEqual(["todo", "review", "leave"])
})

it("only lets you join someone else's task, unless you're a lead who showed their code", () => {
    const theirs = task({ status: "doing", assignee_id: "ben" })
    expect(boardActions(theirs, acting())).toEqual(["join"])
    expect(boardActions(theirs, acting({ level: "code", authority: true }))).toEqual(["join", "todo", "review"])
})

it("reviews only with a code, and never your own work unless you're a lead", () => {
    const waiting = task({ status: "review", assignee_id: "ben", finished_by: "ben" })
    expect(boardActions(waiting, acting())).not.toContain("approve")
    expect(boardActions(waiting, acting({ level: "code" }))).toContain("approve")

    const own = task({ status: "review", assignee_id: "ava", finished_by: "ava" })
    expect(boardActions(own, acting({ level: "code" }))).not.toContain("approve")
    expect(boardActions(own, acting({ level: "code", authority: true }))).toContain("approve")
})
