import type { Acting } from "@/lib/boardApi"
import type { Task, TaskStatus } from "@/lib/tasksApi"

// What the member acting on the task board may do to one task. Mirrors what
// the server allows from a board (backend/endpoints/board.py), so the board
// only shows buttons that work: claiming, joining and leaving are open to
// anyone, moving a task is for the people on it (or a lead who showed their
// code), and reviewing needs a code. Editing, assigning and deleting stay in
// the app.

export type BoardAction = "claim" | "join" | "leave" | "todo" | "doing" | "review" | "approve"

export const BOARD_ACTION_LABEL: Record<BoardAction, string> = {
    claim: "Claim",
    join: "Join",
    leave: "Leave",
    todo: "Move to To do",
    doing: "Move to In progress",
    review: "Ready for review",
    approve: "Mark reviewed",
}

const MOVES: Exclude<TaskStatus, "done">[] = ["todo", "doing", "review"]

export function isOnTask(task: Task, userId: string): boolean {
    return task.assignee_id === userId || task.contributors.some(c => c.id === userId)
}

export function boardActions(task: Task, acting: Acting | null): BoardAction[] {
    if (!acting || task.status === "done") return []
    const me = acting.user_id
    const onTask = isOnTask(task, me)
    const actions: BoardAction[] = []

    if (!task.assignee_id) actions.push("claim")
    else if (!onTask) actions.push("join")

    // An unclaimed task is claimed rather than moved, so it always has someone on it.
    if (task.assignee_id && (onTask || acting.authority)) {
        for (const status of MOVES) if (status !== task.status) actions.push(status)
    }
    // The finisher can't review their own work unless they're a lead (the server enforces the same).
    if (task.status === "review" && acting.level === "code" && (task.finished_by !== me || acting.authority)) {
        actions.push("approve")
    }
    if (onTask) actions.push("leave")
    return actions
}

/** Everyone on a task, assignee first. */
export function peopleOf(task: Task): { id: string; name: string | null; picture: string | null }[] {
    if (!task.assignee_id) return []
    return [
        { id: task.assignee_id, name: task.assignee_name, picture: task.assignee_picture },
        ...task.contributors.map(c => ({ id: c.id, name: c.display_name, picture: c.picture ?? null })),
    ]
}
