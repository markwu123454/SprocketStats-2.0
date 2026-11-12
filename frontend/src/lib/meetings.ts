import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useState } from "react"

import { useBootstrapped } from "../contexts/bootstrapContext"
import type { RoleCatalogEntry } from "@/lib/permissions"

export const MEETINGS_API = `${import.meta.env.VITE_BACKEND_URL}/meeting-hours`

export interface Meeting {
    id: string
    start_time: string
    end_time: string
    meeting_purpose: string | null
    agenda: string
}

export function meetingDate(iso: string): string {
    return new Date(iso).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" })
}

export function meetingTime(meeting: Meeting): string {
    const start = new Date(meeting.start_time)
    const end = new Date(meeting.end_time)
    const time = (date: Date) => date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    return `${time(start)} – ${start.toDateString() !== end.toDateString() ? `${meetingDate(meeting.end_time)}, ` : ""}${time(end)}`
}

/** "Live now" once started, else "Today" / "Tomorrow" / "In N days" by local calendar-day difference. */
export function relativeDayLabel(startIso: string, now: number): string {
    const start = new Date(startIso)
    if (start.getTime() <= now) return "Live now"
    const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
    const days = Math.round((day(start) - day(new Date(now))) / 86400000)
    if (days <= 0) return "Today"
    if (days === 1) return "Tomorrow"
    return `In ${days} days`
}

export function upcomingMeetings(meetings: Meeting[], now: number): Meeting[] {
    return meetings.filter(meeting => new Date(meeting.end_time).getTime() > now)
        .sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time))
}

const EMPTY_MEETINGS: Meeting[] = []
const EMPTY_ABSENCES: MeetingAbsence[] = []

export function useMeetings(revision = 0) {
    // Seeded from /bootstrap (null = no data yet). The fetch below still runs and
    // silently refreshes: with data present there is no skeleton and a failed
    // refresh keeps the data.
    const [data, setData] = useBootstrapped<Meeting[] | null>("meeting_schedule", null)
    const [fetching, setFetching] = useState(true)
    const [failed, setFailed] = useState(false)
    const [attempt, setAttempt] = useState(0)
    const meetings = data ?? EMPTY_MEETINGS
    const loading = fetching && data === null
    const error = failed && data === null
    const setMeetings = useCallback<Dispatch<SetStateAction<Meeting[]>>>(
        value => setData(prev => typeof value === "function" ? value(prev ?? EMPTY_MEETINGS) : value),
        [setData],
    )
    const retry = useCallback(() => setAttempt(value => value + 1), [])

    useEffect(() => {
        const controller = new AbortController()
        setFetching(true)
        setFailed(false)
        fetch(MEETINGS_API, { credentials: "include", signal: controller.signal })
            .then(response => {
                if (!response.ok) throw new Error("load")
                return response.json() as Promise<Meeting[]>
            })
            .then(setData)
            .catch(() => { if (!controller.signal.aborted) setFailed(true) })
            .finally(() => { if (!controller.signal.aborted) setFetching(false) })
        return () => controller.abort()
    }, [revision, attempt, setData])

    return { meetings, setMeetings, loading, error, retry }
}

export interface MeetingAbsence {
    meeting_id: string
    user_id: string
    display_name: string
    role: string
    reason: string
    created_at: string
    updated_at: string
}

/** Group absences by meeting, each group sorted by display name. */
export function absencesByMeeting(list: MeetingAbsence[]): Map<string, MeetingAbsence[]> {
    const grouped = new Map<string, MeetingAbsence[]>()
    for (const absence of list) {
        const group = grouped.get(absence.meeting_id)
        if (group) group.push(absence)
        else grouped.set(absence.meeting_id, [absence])
    }
    for (const group of grouped.values()) group.sort((a, b) => a.display_name.localeCompare(b.display_name))
    return grouped
}

export function useMeetingAbsences(revision = 0) {
    // Seeded from /bootstrap, same rules as useMeetings.
    const [data, setAbsences] = useBootstrapped<MeetingAbsence[] | null>("meeting_absences", null)
    const [fetching, setFetching] = useState(true)
    const [failed, setFailed] = useState(false)
    const [attempt, setAttempt] = useState(0)
    const absences = data ?? EMPTY_ABSENCES
    const loading = fetching && data === null
    const error = failed && data === null
    const retry = useCallback(() => setAttempt(value => value + 1), [])

    useEffect(() => {
        const controller = new AbortController()
        fetch(`${MEETINGS_API}/absences`, { credentials: "include", signal: controller.signal })
            .then(response => {
                if (!response.ok) throw new Error("load")
                return response.json() as Promise<MeetingAbsence[]>
            })
            .then(rows => { setAbsences(rows); setFailed(false) })
            .catch(() => { if (!controller.signal.aborted) setFailed(true) })
            .finally(() => { if (!controller.signal.aborted) setFetching(false) })
        return () => controller.abort()
    }, [revision, attempt, setAbsences])

    return { absences, loading, error, retry }
}

async function absenceRequest(meetingId: string, init: RequestInit): Promise<void> {
    const response = await fetch(`${MEETINGS_API}/${meetingId}/absence`, { credentials: "include", ...init })
    if (response.ok) return
    let detail = ""
    try {
        const body = await response.json() as { detail?: unknown }
        if (typeof body.detail === "string") detail = body.detail
    } catch { /* non-JSON error body */ }
    throw new Error(detail || "Something went wrong. Try again.")
}

export function reportAbsence(meetingId: string, reason: string): Promise<void> {
    return absenceRequest(meetingId, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) })
}

export function withdrawAbsence(meetingId: string): Promise<void> {
    return absenceRequest(meetingId, { method: "DELETE" })
}

/** Role value -> label from the role catalog. Only fetched when `enabled`. */
export function useRoleLabels(enabled: boolean): Map<string, string> {
    const [catalog, setCatalog] = useBootstrapped<RoleCatalogEntry[] | null>("roles", null)
    const labels = useMemo(
        () => new Map((catalog ?? []).map((entry): [string, string] => [entry.value, entry.label])),
        [catalog],
    )
    useEffect(() => {
        if (!enabled) return
        const controller = new AbortController()
        fetch(`${import.meta.env.VITE_BACKEND_URL}/auth/roles`, { credentials: "include", signal: controller.signal })
            .then(response => response.ok ? response.json() as Promise<RoleCatalogEntry[]> : null)
            .then(fresh => { if (fresh) setCatalog(fresh) })
            .catch(() => { /* fall back to the raw role value */ })
        return () => controller.abort()
    }, [enabled, setCatalog])
    return labels
}
