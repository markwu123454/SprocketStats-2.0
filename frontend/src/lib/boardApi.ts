// Client for the `/board` router (backend/endpoints/board.py): the task board on
// a TV in the shop. The board itself is known by its httponly `board_auth`
// cookie; whoever is acting on it right now is known by a short-lived token,
// sent in the `X-Board-Act` header with each change.

import type { Task, TaskNote, TaskStatus } from "@/lib/tasksApi"

const API = import.meta.env.VITE_BACKEND_URL

export interface BoardInfo {
    kiosk_id: string
    /** The subteam it shows by default; null for every subteam. */
    bucket: string | null
    authorized_by_name: string
}

/** The member acting on the board, from POST /board/act/*. */
export interface Acting {
    token: string
    expires_in: number
    /** "code": they showed their code and have their role's say. "email": self-service only. */
    level: "code" | "email"
    user_id: string
    name: string
    first_name: string
    picture: string | null
    /** A lead, captain or mentor who showed their code: may move tasks they aren't on. */
    authority: boolean
}

export type BoardError = Error & { status?: number }

async function boardFetch<T>(path: string, options: { method?: string; body?: unknown; act?: Acting | null } = {}): Promise<T> {
    const headers: Record<string, string> = {}
    if (options.body !== undefined) headers["Content-Type"] = "application/json"
    if (options.act) headers["X-Board-Act"] = options.act.token
    const res = await fetch(`${API}${path}`, {
        method: options.method ?? "GET",
        credentials: "include",
        cache: "no-store",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
    if (!res.ok) {
        const data = await res.json().catch(() => null) as { detail?: unknown } | null
        const detail = typeof data?.detail === "string" ? data.detail : `HTTP ${res.status}`
        throw Object.assign(new Error(detail), { status: res.status }) as BoardError
    }
    return res.json() as Promise<T>
}

/** A request failed because the board isn't set up (any more), not because of who is acting. */
export function isBoardGone(err: unknown): boolean {
    return err instanceof Error && (err as BoardError).status === 401
        && /set up this board|deauthorized/i.test(err.message)
}

/** A request failed because the acting member's token lapsed or is missing. */
export function isSignedOut(err: unknown): boolean {
    return err instanceof Error && (err as BoardError).status === 401 && !isBoardGone(err)
}

/** Worth reading the same code appearance again: no connection, or a code that went stale in flight. */
export function isRetryable(err: unknown): boolean {
    const status = err instanceof Error ? (err as BoardError).status : undefined
    return status === undefined || status === 409
}

/** Server-written detail as-is; a network failure gets our own copy. */
export function boardErrorMessage(err: unknown): string {
    if (err instanceof Error && typeof (err as BoardError).status === "number" && !err.message.startsWith("HTTP ")) return err.message
    return "No connection. Try again."
}

/** How far this device's clock is behind the server's, in ms. A code is judged
 *  against the moment it was read, so that moment must be on the server's clock. */
export async function serverClockOffset(): Promise<number> {
    const sentAt = Date.now()
    const res = await fetch(`${API}/kiosk/clock`, { cache: "no-store" })
    const receivedAt = Date.now()
    if (!res.ok) throw new Error("Couldn't read the server clock")
    const { server_time } = await res.json() as { server_time: number }
    return server_time * 1000 - (sentAt + receivedAt) / 2
}

/** The body every code scan sends: the code, when it was read, and an id for this appearance. */
export interface CodeScan {
    code: string
    scanned_at: number
    scan_id: string
}

export const fetchBoard = () => boardFetch<BoardInfo>("/board")
export const authorizeBoard = (scan: CodeScan) => boardFetch<BoardInfo>("/board/authorize", { method: "POST", body: scan })
/** Turns the board off. Anyone at the board may; setting it up again takes a lead's code. */
export const logoutBoard = () => boardFetch<{ ok: boolean }>("/board/logout", { method: "POST" })

/** Open tasks and those done in the last week. */
export const fetchBoardTasks = () => boardFetch<Task[]>("/board/tasks")
export const fetchBoardNotes = (taskId: string) => boardFetch<TaskNote[]>(`/board/tasks/${taskId}/notes`)

export const actWithCode = (scan: CodeScan) => boardFetch<Acting>("/board/act/code", { method: "POST", body: scan })
export const actWithEmail = (email: string) => boardFetch<Acting>("/board/act/email", { method: "POST", body: { email } })

export const claimOnBoard = (act: Acting, id: string) => boardFetch<Task>(`/board/tasks/${id}/claim`, { method: "POST", act })
export const joinOnBoard = (act: Acting, id: string) => boardFetch<Task>(`/board/tasks/${id}/join`, { method: "POST", act })
export const leaveOnBoard = (act: Acting, id: string) => boardFetch<Task>(`/board/tasks/${id}/leave`, { method: "POST", act })
export const moveOnBoard = (act: Acting, id: string, status: Exclude<TaskStatus, "done">) =>
    boardFetch<Task>(`/board/tasks/${id}/status`, { method: "POST", act, body: { status } })
export const reviewOnBoard = (act: Acting, id: string) => boardFetch<Task>(`/board/tasks/${id}/review`, { method: "POST", act })
export const noteOnBoard = (act: Acting, id: string, body: string) =>
    boardFetch<TaskNote>(`/board/tasks/${id}/notes`, { method: "POST", act, body: { body } })

// Someone is using the board right now (acting, or a task is open). The update
// prompt waits for this to clear before reloading the board onto a new build.
let busy = false
export function setBoardBusy(value: boolean) { busy = value }
export function isBoardBusy(): boolean { return busy }
