// Typed client for the `/tasks` router. Mirrors the fetch idiom in
// `@/lib/eventApi.ts` (VITE_BACKEND_URL base, `credentials: "include"`), but
// adds write methods and readable-error surfacing (see TASKS_CONTRACT.md): a
// failed request throws an `Error` whose `message` is the backend's `detail`
// string when present (e.g. the 403 from marking your own task reviewed) and
// carries the HTTP status as `.status` for callers that want to branch on it.

const API = import.meta.env.VITE_BACKEND_URL

export type TaskPriority = "high" | "med" | "low"
export type TaskStatus = "todo" | "doing" | "review" | "done"

export const PRIORITY_LABEL: Record<TaskPriority, string> = { high: "High", med: "Medium", low: "Low" }
export const STATUS_LABEL: Record<TaskStatus, string> = {
    todo: "To do",
    doing: "In progress",
    review: "Needs review",
    done: "Done",
}

export interface Task {
    id: string
    title: string
    area: string
    bucket: string
    priority: TaskPriority
    status: TaskStatus
    assignee_id: string | null
    assignee_name: string | null
    due_date: string | null // "YYYY-MM-DD"
    created_by: string
    created_by_name: string | null
    finished_by: string | null
    finished_by_name: string | null
    reviewed_by: string | null
    reviewed_by_name: string | null
    created_at: string
    updated_at: string
}

export interface Person {
    id: string
    display_name: string
}

export interface CreateTaskInput {
    title: string
    bucket: string
    area?: string
    priority?: TaskPriority
    due_date?: string | null
    assignee_id?: string | null
}

/** PATCH body — a subset of the editable fields. `status` excludes "done":
 *  the backend only reaches it through the review endpoint. */
export interface UpdateTaskInput {
    title?: string
    area?: string
    bucket?: string
    priority?: TaskPriority
    status?: Exclude<TaskStatus, "done">
    assignee_id?: string | null
    due_date?: string | null
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${API}${path}`, {
        credentials: "include",
        headers: init?.body ? { "Content-Type": "application/json" } : undefined,
        ...init,
    })
    if (!res.ok) {
        const data = await res.json().catch(() => null) as { detail?: string } | null
        throw Object.assign(new Error(data?.detail ?? `HTTP ${res.status}`), { status: res.status })
    }
    if (res.status === 204) return undefined as T
    return res.json() as Promise<T>
}

export function fetchTasks(): Promise<Task[]> {
    return apiFetch<Task[]>("/tasks")
}

/** Names + ids only (never emails) — any authed user, unlike leads-only `/members`. */
export function fetchPeople(): Promise<Person[]> {
    return apiFetch<Person[]>("/tasks/people")
}

export function createTask(input: CreateTaskInput): Promise<Task> {
    return apiFetch<Task>("/tasks", { method: "POST", body: JSON.stringify(input) })
}

export function updateTask(id: string, patch: UpdateTaskInput): Promise<Task> {
    return apiFetch<Task>(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(patch) })
}

/** Any authed user may claim any unassigned task; 409 if it's already taken. */
export function claimTask(id: string): Promise<Task> {
    return apiFetch<Task>(`/tasks/${id}/claim`, { method: "POST" })
}

/** Anyone except `finished_by` may mark a `review` task `done`. */
export function reviewTask(id: string): Promise<Task> {
    return apiFetch<Task>(`/tasks/${id}/review`, { method: "POST" })
}

/** Authority set or creator only — sends a `done` task back to `review`. */
export function unreviewTask(id: string): Promise<Task> {
    return apiFetch<Task>(`/tasks/${id}/unreview`, { method: "POST" })
}

export function deleteTask(id: string): Promise<void> {
    return apiFetch<void>(`/tasks/${id}`, { method: "DELETE" })
}
