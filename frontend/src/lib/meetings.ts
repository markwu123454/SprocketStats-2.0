import { useCallback, useEffect, useState } from "react"

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

export function upcomingMeetings(meetings: Meeting[], now: number): Meeting[] {
    return meetings.filter(meeting => new Date(meeting.end_time).getTime() > now)
        .sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time))
}

export function useMeetings(revision = 0) {
    const [meetings, setMeetings] = useState<Meeting[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(false)
    const [attempt, setAttempt] = useState(0)
    const retry = useCallback(() => setAttempt(value => value + 1), [])

    useEffect(() => {
        const controller = new AbortController()
        setLoading(true)
        setError(false)
        fetch(MEETINGS_API, { credentials: "include", signal: controller.signal })
            .then(response => {
                if (!response.ok) throw new Error("load")
                return response.json() as Promise<Meeting[]>
            })
            .then(setMeetings)
            .catch(() => { if (!controller.signal.aborted) setError(true) })
            .finally(() => { if (!controller.signal.aborted) setLoading(false) })
        return () => controller.abort()
    }, [revision, attempt])

    return { meetings, setMeetings, loading, error, retry }
}
