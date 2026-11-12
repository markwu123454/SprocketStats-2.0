import { describe, expect, it } from "vitest"
import { absencesByMeeting, relativeDayLabel, upcomingMeetings, type Meeting, type MeetingAbsence } from "./meetings"

describe("upcoming meetings", () => {
    it("includes live and future meetings in order, excludes ended meetings, and keeps multiple meetings on one day", () => {
        const meeting = (id: string, start: string, end: string): Meeting => ({ id, start_time: `2026-10-31T${start}:00Z`, end_time: `2026-10-31T${end}:00Z`, agenda: "", meeting_purpose: null })
        const rows = [meeting("later", "18:00", "19:00"), meeting("ended", "13:00", "14:00"), meeting("live", "14:00", "16:00"), meeting("next", "16:00", "17:00")]
        expect(upcomingMeetings(rows, Date.parse("2026-10-31T14:00:00Z")).map(row => row.id)).toEqual(["live", "next", "later"])
        expect(rows[0].id).toBe("later")
    })
})

describe("absencesByMeeting", () => {
    it("groups by meeting and sorts each group by display name", () => {
        const row = (meeting_id: string, user_id: string, display_name: string): MeetingAbsence =>
            ({ meeting_id, user_id, display_name, role: "cad_member", reason: "", created_at: "", updated_at: "" })
        const grouped = absencesByMeeting([row("a", "1", "Zed"), row("b", "2", "Kim"), row("a", "3", "Ava")])
        expect(grouped.get("a")?.map(r => r.display_name)).toEqual(["Ava", "Zed"])
        expect(grouped.get("b")).toHaveLength(1)
        expect(grouped.get("c")).toBeUndefined()
    })
})

describe("relativeDayLabel", () => {
    const now = new Date(2026, 10, 11, 20, 0).getTime()
    const at = (day: number, hour: number) => new Date(2026, 10, day, hour, 0).toISOString()
    it("labels live, same-day, next-day and later meetings by local calendar day", () => {
        expect(relativeDayLabel(at(11, 18), now)).toBe("Live now")
        expect(relativeDayLabel(at(11, 22), now)).toBe("Today")
        expect(relativeDayLabel(at(12, 1), now)).toBe("Tomorrow")
        expect(relativeDayLabel(at(16, 16), now)).toBe("In 5 days")
    })
})
