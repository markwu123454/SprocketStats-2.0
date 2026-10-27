import { describe, expect, it } from "vitest"
import { checkInRolesOf, defaultCheckInRole, findByHubKey, formatCountdown, hasEventPage, hiddenTabsOf, isCheckInOpen, isHubOpen, pickActiveEvent, resolveEvent } from "./events"

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

describe("hasEventPage", () => {
    const allHidden = ["itinerary", "packing", "roster", "comp", "tasks"] as const
    const base = { name: "A", start: "2026-11-01", location: "", type: "" }

    it("has a page by default", () => {
        expect(hasEventPage(base)).toBe(true)
    })

    it("has no page with every tab hidden and no Overview text", () => {
        expect(hasEventPage({ ...base, hiddenTabs: [...allHidden] })).toBe(false)
        expect(hasEventPage({ ...base, hiddenTabs: [...allHidden], description: "   " })).toBe(false)
    })

    it("keeps the page when there's Overview text or any tab left", () => {
        expect(hasEventPage({ ...base, hiddenTabs: [...allHidden], description: "Come help!" })).toBe(true)
        expect(hasEventPage({ ...base, hiddenTabs: ["itinerary", "packing", "comp", "tasks"] })).toBe(true)
    })

    it("doesn't count Comp for an event without a TBA key", () => {
        // Comp is forced hidden here, so hiding the other four leaves nothing.
        expect(hasEventPage({ ...base, hiddenTabs: ["itinerary", "packing", "roster", "tasks"] })).toBe(false)
    })
})

describe("check-in turned off", () => {
    it("never opens check-in, even with an opening time in the past", () => {
        const off = resolveEvent({ name: "A", start: "2026-10-21", checkinOpens: "2026-10-01", checkinEnabled: false, location: "", type: "" }, now)
        expect(isCheckInOpen(off, now.getTime())).toBe(false)
    })

    it("still shows a happening event on the dashboard, but not ahead of time", () => {
        const happening = { name: "Now", start: "2026-10-21", checkinEnabled: false, location: "", type: "" }
        const early = { name: "Soon", start: "2026-11-20", checkinOpens: "2026-10-01", checkinEnabled: false, location: "", type: "" }
        expect(pickActiveEvent([happening], now)?.name).toBe("Now")
        expect(pickActiveEvent([early], now)).toBeNull()
    })
})

describe("check-in roles", () => {
    it("falls back to the default roles, preselecting Attending", () => {
        const base = { name: "A", start: "2026-11-01", location: "", type: "" }
        expect(checkInRolesOf(base).map((r) => r.key)).toEqual(["attending", "drive_team", "pit_crew", "mentor"])
        expect(defaultCheckInRole(base)).toBe("attending")
    })

    it("uses an event's own roles, preselecting the first when there's no Attending", () => {
        const custom = { name: "A", start: "2026-11-01", location: "", type: "",
            checkinRoles: [{ key: "volunteer", label: "Volunteer" }, { key: "booth", label: "Booth" }] }
        expect(checkInRolesOf(custom).map((r) => r.label)).toEqual(["Volunteer", "Booth"])
        expect(defaultCheckInRole(custom)).toBe("volunteer")
    })
})
