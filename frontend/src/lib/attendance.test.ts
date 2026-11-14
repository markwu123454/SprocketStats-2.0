import { describe, expect, it } from "vitest"
import {
    attendanceRate, fuzzyScore, memberMatch, pastStrip, pointsPerHour, reportedAbsences, teamAttendance, upcomingStrip,
    type AttendanceData, type AttendanceMember,
} from "./attendance"
import { hoursMultiplier, multiplierLabel, type Meeting, type MeetingAbsence } from "./meetings"

const now = Date.parse("2026-11-11T12:00:00Z")

const meeting = (id: string, start: string, end: string, hours_multiplier?: number): Meeting =>
    ({ id, start_time: start, end_time: end, meeting_purpose: null, agenda: "", hours_multiplier })
const absence = (meeting_id: string, user_id: string): MeetingAbsence => ({
    meeting_id, user_id, display_name: "", role: "cad_member", reason: "", created_at: "", updated_at: "",
})
const member = (user_id: string, display_name: string, created_at = "2026-01-01T00:00:00Z"): AttendanceMember => ({
    user_id, display_name, role: "cad_member", created_at,
})

const data: AttendanceData = {
    meetings: [
        meeting("old", "2026-11-01T17:00:00Z", "2026-11-01T19:00:00Z"),
        meeting("mid", "2026-11-04T17:00:00Z", "2026-11-04T19:00:00Z"),
        meeting("recent", "2026-11-08T17:00:00Z", "2026-11-08T20:00:00Z"),
        meeting("live", "2026-11-11T11:00:00Z", "2026-11-11T13:00:00Z"),
        meeting("next", "2026-11-15T17:00:00Z", "2026-11-15T19:00:00Z"),
    ],
    members: [
        member("u1", "Zed"),
        member("u2", "Amy"),
        // Joined after "old" and "mid": only "recent" counts as past for them.
        member("u3", "New Kid", "2026-11-05T00:00:00Z"),
        member("u4", "Perfect"),
    ],
    absences: [absence("old", "u1"), absence("recent", "u1"), absence("recent", "u2"), absence("live", "u2"), absence("next", "u3")],
}

describe("teamAttendance", () => {
    const rows = teamAttendance(data, "past", now)

    it("lists every member, most missed first then by name, when hours are level", () => {
        expect(rows.map(r => [r.member.display_name, r.missed.length])).toEqual([["Zed", 2], ["Amy", 1], ["New Kid", 0], ["Perfect", 0]])
    })

    it("only expects meetings that started after the account was created", () => {
        const kid = rows.find(r => r.member.user_id === "u3")!
        expect(kid.expected.map(m => m.id)).toEqual(["recent"])
        expect(rows.find(r => r.member.user_id === "u4")!.expected).toHaveLength(3)
    })

    it("credits every meeting in full when the system has no go-live date", () => {
        const zed = rows[0]
        expect(zed.possibleSeconds).toBe((2 + 2 + 3) * 3600)
        expect(zed.earnedSeconds).toBe(zed.possibleSeconds)
        expect(zed.lastMissed).toBe("2026-11-08T17:00:00Z")
    })

    it("treats a live meeting as upcoming", () => {
        const upcoming = teamAttendance(data, "upcoming", now)
        expect(upcoming.find(r => r.member.user_id === "u2")!.missed.map(x => x.meeting.id)).toEqual(["live"])
    })
})

describe("fuzzyScore", () => {
    it("matches characters in order, ignoring case and accents", () => {
        expect(fuzzyScore("jalv", "Jordan Alvarez")).not.toBeNull()
        expect(fuzzyScore("jose", "José")).not.toBeNull()
        expect(fuzzyScore("xyz", "Jordan")).toBeNull()
        expect(fuzzyScore("", "anything")).toBe(0)
    })

    it("ranks word-start and consecutive matches higher", () => {
        expect(fuzzyScore("sam", "Sam Lee")!).toBeGreaterThan(fuzzyScore("sam", "Isa Mendez")!)
    })

    it("searches role labels too, below an equal name hit", () => {
        const m = member("u", "Priya")
        expect(memberMatch("cad", m, "CAD Member")).not.toBeNull()
        expect(memberMatch("zzz", m, "CAD Member")).toBeNull()
    })
})

describe("once the attendance system is live", () => {
    // Live from Nov 6: "old" and "mid" (2h each) predate it and don't count. "recent" (3h, worth
    // double) and everything after require a check-in.
    const checkin = (meeting_id: string, user_id: string, hours: number) => ({ meeting_id, user_id, seconds: hours * 3600 })
    const live: AttendanceData = {
        ...data,
        meetings: data.meetings.map(m => m.id === "recent" ? meeting("recent", m.start_time, m.end_time, 2) : m),
        active_from: "2026-11-06T00:00:00Z",
        absences: [absence("old", "u1"), absence("recent", "u2"), absence("recent", "u4"), absence("next", "u3")],
        checkins: [
            checkin("recent", "u1", 3),     // Zed: all of it
            checkin("recent", "u4", 1.5),   // Perfect: half of it, despite reporting an absence
            checkin("live", "u1", 1),
        ],
    }
    const rows = teamAttendance(live, "past", now)
    const row = (id: string) => rows.find(r => r.member.user_id === id)!
    const missedIds = (id: string) => row(id).missed.map(x => x.meeting.id)
    const recent = live.meetings[2]

    it("marks not checking in as an absence, reported or not", () => {
        expect(row("u3").missed).toEqual([{ meeting: recent, absence: null }])
        expect(row("u2").missed).toEqual([{ meeting: recent, absence: live.absences[1] }])
    })

    it("lets checking in cancel a reported absence", () => {
        expect(missedIds("u4")).toEqual([])
    })

    it("doesn't count meetings before go-live, but still lists absences reported for them", () => {
        // Zed reported an absence for "old": not a miss, but still in his absences list.
        expect(missedIds("u1")).toEqual([])
        const zedUpcoming = teamAttendance(live, "upcoming", now).find(r => r.member.user_id === "u1")!
        expect(reportedAbsences(row("u1"), zedUpcoming).past.map(x => x.meeting.id)).toEqual(["old"])
        expect(row("u1").expected.map(m => m.id)).toEqual(["recent"])
        expect(row("u2").expected.map(m => m.id)).toEqual(["recent"])
    })

    it("earns hours only for time checked in after go-live, weighted by the multiplier", () => {
        expect(row("u1").possibleSeconds).toBe(3 * 2 * 3600)
        expect(attendanceRate(row("u1"))).toBe(1)     // all of the x2 meeting
        expect(attendanceRate(row("u2"))).toBe(0)     // skipped it
        expect(attendanceRate(row("u4"))).toBe(0.5)   // half of it
        expect(attendanceRate(row("u3"))).toBe(0)
    })

    it("lists the lowest share of hours first", () => {
        expect(rows.map(r => r.member.display_name)).toEqual(["Amy", "New Kid", "Perfect", "Zed"])
    })

    it("leaves live and future meetings to reported absences, with no rate", () => {
        const upcoming = teamAttendance(live, "upcoming", now)
        expect(upcoming.flatMap(r => r.missed.map(x => `${r.member.user_id}:${x.meeting.id}`))).toEqual(["u3:next"])
    })
})

describe("hoursMultiplier", () => {
    it("defaults to 1 and stays between 1 and 2", () => {
        expect(hoursMultiplier({})).toBe(1)
        expect(hoursMultiplier({ hours_multiplier: null })).toBe(1)
        expect(hoursMultiplier({ hours_multiplier: 1.5 })).toBe(1.5)
        expect(hoursMultiplier({ hours_multiplier: 7 })).toBe(2)
        expect(hoursMultiplier({ hours_multiplier: 0 })).toBe(1)
    })

    it("labels a multiplier", () => {
        expect([1, 1.5, 1.25, 2].map(multiplierLabel)).toEqual(["×1.0", "×1.5", "×1.25", "×2.0"])
    })
})

describe("pointsPerHour", () => {
    it("divides points by hours earned", () => {
        expect(pointsPerHour(9, 3 * 3600)).toBe(3)
        expect(pointsPerHour(5, 2 * 3600)).toBe(2.5)
    })

    it("is null with no hours to divide by", () => {
        expect(pointsPerHour(4, 0)).toBeNull()
    })
})

describe("strips and reported absences", () => {
    const hour = (i: number) => meeting(`m${i}`, `2026-10-${String(i + 1).padStart(2, "0")}T17:00:00Z`, `2026-10-${String(i + 1).padStart(2, "0")}T19:00:00Z`)
    const future = (i: number) => meeting(`f${i}`, `2026-11-${String(i + 15).padStart(2, "0")}T17:00:00Z`, `2026-11-${String(i + 15).padStart(2, "0")}T19:00:00Z`)
    const strip: AttendanceData = {
        // 12 finished meetings (m0..m11) and 7 upcoming ones (f0..f6), listed out of order.
        meetings: [...Array.from({ length: 12 }, (_, i) => hour(11 - i)), ...Array.from({ length: 7 }, (_, i) => future(6 - i))],
        members: [member("u1", "Zed"), member("u2", "Amy")],
        absences: [absence("m3", "u1"), absence("m4", "u1"), absence("f1", "u1"), absence("f9", "u1"), absence("f0", "u1")],
    }
    const t = Date.parse("2026-11-14T12:00:00Z")
    const past = teamAttendance(strip, "past", t).find(r => r.member.user_id === "u1")!
    const upcoming = teamAttendance(strip, "upcoming", t).find(r => r.member.user_id === "u1")!

    it("shows the last 10 finished meetings, oldest first", () => {
        // m2..m11; m3 and m4 were missed.
        expect(pastStrip(past)).toEqual(["attended", "missed", "missed", "attended", "attended", "attended", "attended", "attended", "attended", "attended"])
        expect(past.expected).toHaveLength(12)
    })

    it("shows fewer boxes when fewer meetings exist", () => {
        const amy = teamAttendance({ ...strip, meetings: strip.meetings.slice(0, 2) }, "past", t).find(r => r.member.user_id === "u2")!
        expect(pastStrip(amy)).toEqual(["attended", "attended"])
    })

    it("shows the next 5 meetings, soonest first, marking reported absences", () => {
        expect(upcomingStrip(upcoming)).toEqual(["absent", "absent", "scheduled", "scheduled", "scheduled"])
    })

    it("lists reported absences only, latest first", () => {
        const noShow = { ...past, missed: [...past.missed, { meeting: strip.meetings[0], absence: null }] }
        const list = reportedAbsences(noShow, upcoming)
        expect(list.past.map(x => x.meeting.id)).toEqual(["m4", "m3"])
        expect(list.upcoming.map(x => x.meeting.id)).toEqual(["f1", "f0"])
    })
})
