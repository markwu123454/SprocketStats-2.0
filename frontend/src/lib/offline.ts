/**
 * Offline mode: what this phone keeps so a member can still sign in, see their
 * info and show My code with no connection (or one too slow to use).
 *
 * - The connection check is GET /auth/me with a 3 s limit. It answers "can we
 *   reach the server" and "is the session still good" in one request; while
 *   the server can't be reached the app repeats it every 5 s.
 * - Offline sign-in is only offered within 30 days of the last time this phone
 *   reached the server signed in.
 * - What pages show offline is the last /bootstrap response, cut down to
 *   OFFLINE_KEYS (no control-panel data, so other members' details never sit
 *   on a phone) and saved per member.
 * - Signing out with no connection can't clear the session cookie (httpOnly),
 *   so it is remembered and done on the next check that gets through.
 *
 * Everything here is cleared on sign-out and when the server says the session
 * is gone (AuthProvider's forgetDevice).
 */

import type {ConnectionProblem} from "@/contexts/authContext"

export const CHECK_TIMEOUT_MS = 3000
export const RETRY_MS = 5000
export const OFFLINE_LOGIN_MS = 30 * 24 * 60 * 60 * 1000

const LAST_ONLINE_KEY = "sprocket-last-online"
const SNAPSHOT_KEY = "sprocket-offline-snapshot"
const PENDING_LOGOUT_KEY = "sprocket-pending-logout"

/** /bootstrap keys saved for offline use. Everything a member's own pages read; nothing from the control panel. */
export const OFFLINE_KEYS = [
    "events", "meetings", "current_event", "event_keys",
    "tasks", "task_people", "meeting_schedule", "meeting_absences",
    "attendance_leaderboard", "roles", "attendance_me",
] as const

function read(key: string): string | null {
    try {
        return localStorage.getItem(key)
    } catch {
        return null
    }
}

function write(key: string, value: string | null) {
    try {
        if (value === null) localStorage.removeItem(key)
        else localStorage.setItem(key, value)
    } catch {
        // Storage blocked or full: offline mode just has less to work with.
    }
}

// ── Last time online ─────────────────────────────────────────────────────────

export function markOnline(now = Date.now()) {
    write(LAST_ONLINE_KEY, String(now))
}

/** When this phone last reached the server signed in, or null if never (or not since this was added). */
export function lastOnlineAt(): number | null {
    const value = Number(read(LAST_ONLINE_KEY))
    return Number.isFinite(value) && value > 0 ? value : null
}

/** Whether something last confirmed online at `since` can still be used offline. */
export function withinOfflineWindow(since: number | null, now = Date.now()): boolean {
    return since !== null && now - since <= OFFLINE_LOGIN_MS
}

// ── Saved bootstrap ──────────────────────────────────────────────────────────

export interface OfflineSnapshot {
    userId: string
    savedAt: number
    data: Record<string, unknown>
}

export function pickOfflineKeys(data: Record<string, unknown>): Record<string, unknown> {
    const picked: Record<string, unknown> = {}
    for (const key of OFFLINE_KEYS) if (key in data) picked[key] = data[key]
    return picked
}

export function saveOfflineSnapshot(userId: string, data: Record<string, unknown>, savedAt = Date.now()) {
    const snapshot: OfflineSnapshot = {userId, savedAt, data: pickOfflineKeys(data)}
    write(SNAPSHOT_KEY, JSON.stringify(snapshot))
}

/** The saved snapshot, only if it belongs to `userId`. */
export function loadOfflineSnapshot(userId: string): OfflineSnapshot | null {
    try {
        const raw = read(SNAPSHOT_KEY)
        const snapshot = raw ? JSON.parse(raw) as OfflineSnapshot : null
        return snapshot && snapshot.userId === userId && snapshot.data ? snapshot : null
    } catch {
        return null
    }
}

// ── Sign-out with no connection ──────────────────────────────────────────────

export function setPendingLogout() {
    write(PENDING_LOGOUT_KEY, "1")
}

export function hasPendingLogout(): boolean {
    return read(PENDING_LOGOUT_KEY) === "1"
}

function clearPendingLogout() {
    write(PENDING_LOGOUT_KEY, null)
}

/** Forget everything offline mode saved (the pending sign-out stays until it's done). */
export function clearOfflineData() {
    write(LAST_ONLINE_KEY, null)
    write(SNAPSHOT_KEY, null)
}

// ── The connection check ─────────────────────────────────────────────────────

export type SessionCheck =
    | {kind: "user", me: Record<string, unknown>}
    | {kind: "signedOut"}
    | {kind: "blocked", detail: string | undefined}
    | {kind: "unreachable", problem: ConnectionProblem}

/**
 * GET /auth/me within `timeoutMs`, classified. A sign-out made while offline is
 * sent first. The whole thing (both requests and reading the body) shares the
 * one time limit, so a connection that trickles counts as too slow.
 */
export async function checkSession(api: string, timeoutMs = CHECK_TIMEOUT_MS): Promise<SessionCheck> {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
        return {kind: "unreachable", problem: "noNetwork"}
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        if (hasPendingLogout()) {
            const out = await fetch(`${api}/auth/logout`, {method: "POST", credentials: "include", signal: controller.signal})
            if (out.status >= 500) return {kind: "unreachable", problem: "serverDown"}
            clearPendingLogout()
        }
        const res = await fetch(`${api}/auth/me`, {credentials: "include", cache: "no-store", signal: controller.signal})
        if (res.status === 401) return {kind: "signedOut"}
        if (res.status === 403) {
            const detail = await res.json().then((d: {detail?: unknown}) => d?.detail).catch(() => undefined)
            return {kind: "blocked", detail: typeof detail === "string" ? detail : undefined}
        }
        // Anything else that isn't OK is a broken backend (404/500/503...): it
        // can't sign anyone in, but offline mode still works.
        if (!res.ok) return {kind: "unreachable", problem: "serverDown"}
        return {kind: "user", me: await res.json() as Record<string, unknown>}
    } catch {
        return {kind: "unreachable", problem: controller.signal.aborted ? "slow" : "noNetwork"}
    } finally {
        clearTimeout(timer)
    }
}
