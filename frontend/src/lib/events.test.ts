import { describe, expect, it } from "vitest"
import { formatCountdown, isHubOpen, resolveEvent } from "./events"

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
