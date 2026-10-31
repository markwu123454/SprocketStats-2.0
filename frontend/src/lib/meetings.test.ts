import { describe, expect, it } from "vitest"
import { upcomingMeetings, type Meeting } from "./meetings"

describe("upcoming meetings", () => {
    it("includes live and future meetings in order, excludes ended meetings, and keeps multiple meetings on one day", () => {
        const meeting = (id: string, start: string, end: string): Meeting => ({ id, start_time: `2026-10-31T${start}:00Z`, end_time: `2026-10-31T${end}:00Z`, agenda: "", meeting_purpose: null })
        const rows = [meeting("later", "18:00", "19:00"), meeting("ended", "13:00", "14:00"), meeting("live", "14:00", "16:00"), meeting("next", "16:00", "17:00")]
        expect(upcomingMeetings(rows, Date.parse("2026-10-31T14:00:00Z")).map(row => row.id)).toEqual(["live", "next", "later"])
        expect(rows[0].id).toBe("later")
    })
})
