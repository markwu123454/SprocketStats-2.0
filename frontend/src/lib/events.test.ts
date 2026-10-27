import { describe, expect, it } from "vitest"
import { findByHubKey, formatCountdown, hiddenTabsOf, isCheckInOpen, isHubOpen, pickActiveEvent, resolveEvent } from "./events"

const DAY = 24 * 60 * 60 * 1000
const now = new Date("2026-10-21T12:00")

describe("isHubOpen", () => {
    it("opens an upcoming event's hub only within two weeks of its start", () => {
        const far = resolveEvent({ name: "A", start: "2026-11-05", location: "", type: "" }, now)
        const near = resolveEvent({ name: "B", start: "2026-11-04", location: "", type: "" }, now)
        expect(far.status).toBe("upcoming")
        expect(isHubOpen(far, now.getTime())).toBe(false)
        expect(isHubOpen(near, now.getTime())).toBe(true)
    })

    it("always opens current and done events", () => {
        const current = resolveEvent({ name: "C", start: "2026-10-20", end: "2026-10-22", location: "", type: "" }, now)
        const done = resolveEvent({ name: "D", start: "2026-03-19", end: "2026-03-21", location: "", type: "" }, now)
        expect(isHubOpen(current, now.getTime())).toBe(true)
        expect(isHubOpen(done, now.getTime())).toBe(true)
    })
})

describe("formatCountdown", () => {
    it("shows days/hours/minutes when a day or more away", () => {
        expect(formatCountdown(12 * DAY + 4 * 3600_000 + 31 * 60_000 + 9_000)).toBe("12d 04h 31m")
    })

    it("shows hours/minutes/seconds inside the last day", () => {
        expect(formatCountdown(4 * 3600_000 + 31 * 60_000 + 9_000)).toBe("04h 31m 09s")
    })

    it("never goes negative", () => {
        expect(formatCountdown(-5000)).toBe("00h 00m 00s")
    })
})

describe("isCheckInOpen", () => {
    it("opens at the event start when no checkinOpens is set", () => {
        const upcoming = resolveEvent({ name: "A", start: "2026-10-22", location: "", type: "" }, now)
        const current = resolveEvent({ name: "B", start: "2026-10-21", location: "", type: "" }, now)
        expect(isCheckInOpen(upcoming, now.getTime())).toBe(false)
        expect(isCheckInOpen(current, now.getTime())).toBe(true)
    })

    it("opens early at checkinOpens, down to the minute", () => {
        const opened = resolveEvent({ name: "A", start: "2026-11-20", checkinOpens: "2026-10-21T11:59", location: "", type: "" }, now)
        const notYet = resolveEvent({ name: "B", start: "2026-11-20", checkinOpens: "2026-10-21T12:01", location: "", type: "" }, now)
        expect(isCheckInOpen(opened, now.getTime())).toBe(true)
        expect(isCheckInOpen(notYet, now.getTime())).toBe(false)
    })

    it("closes once the event is over", () => {
        const done = resolveEvent({ name: "D", start: "2026-03-19", checkinOpens: "2026-03-01", location: "", type: "" }, now)
        expect(isCheckInOpen(done, now.getTime())).toBe(false)
    })

    it("opens the hub early along with check-in", () => {
        const far = resolveEvent({ name: "A", start: "2026-12-20", checkinOpens: "2026-10-01", location: "", type: "" }, now)
        expect(isHubOpen(far, now.getTime())).toBe(true)
    })
})

describe("pickActiveEvent", () => {
    it("shows an upcoming event whose check-in is open", () => {
        const picked = pickActiveEvent([
            { name: "Later", start: "2026-12-01", location: "", type: "" },
            { name: "Soon", start: "2026-11-20", checkinOpens: "2026-10-20", tbaKey: "2026soon", location: "", type: "" },
        ], now)
        expect(picked?.name).toBe("Soon")
    })

    it("prefers a happening event over a check-in-only one", () => {
        const picked = pickActiveEvent([
            { name: "Soon", start: "2026-11-20", checkinOpens: "2026-10-20", tbaKey: "2026soon", location: "", type: "" },
            { name: "Now", start: "2026-10-21", location: "", type: "" },
        ], now)
        expect(picked?.name).toBe("Now")
    })

    it("returns null when nothing is happening or open", () => {
        expect(pickActiveEvent([{ name: "Later", start: "2026-12-01", location: "", type: "" }], now)).toBeNull()
    })
})

describe("hub keys for non-TBA events", () => {
    const outreach = { name: "Outreach", start: "2026-11-01", location: "", type: "", hubKey: "e12" }
    const comp = { name: "Regional", start: "2026-03-19", location: "", type: "", tbaKey: "2026cass", hubKey: "2026cass" }

    it("finds an event by its e<id> hub key", () => {
        expect(findByHubKey([comp, outreach], "e12")?.name).toBe("Outreach")
        expect(findByHubKey([comp, outreach], "2026cass")?.name).toBe("Regional")
        expect(findByHubKey([comp, outreach], "e99")).toBeUndefined()
    })

    it("always hides Comp for an event without a TBA key", () => {
        expect(hiddenTabsOf(outreach)).toEqual(["comp"])
        expect(hiddenTabsOf({ ...outreach, hiddenTabs: ["packing"] })).toEqual(["packing", "comp"])
        expect(hiddenTabsOf(comp)).toEqual([])
    })
})
