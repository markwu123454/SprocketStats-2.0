import { describe, expect, it } from "vitest"

import {
    buildDt,
    cleanStrings,
    currentItineraryIndex,
    dayKey,
    groupItineraryByDay,
    replaceDay,
    saveErrorMessage,
    sortItinerary,
    timeOf,
    validateInstruction,
    validateItineraryDay,
    validatePackingCategory,
} from "./eventContent"
import type { ItineraryItem } from "./eventApi"

// All assertions here stay on the string parts of no-suffix local datetimes
// ("YYYY-MM-DDTHH:MM:SS") rather than going through `Date`, so nothing here
// depends on the timezone the test runner happens to execute in.

function item(dt: string, label = "Item", detail: string | null = null): ItineraryItem {
    return { dt, label, detail }
}

describe("dayKey / timeOf / buildDt", () => {
    it("slices the day and time out of a no-suffix datetime", () => {
        expect(dayKey("2026-08-13T07:00:00")).toBe("2026-08-13")
        expect(timeOf("2026-08-13T07:00:00")).toBe("07:00")
    })

    it("round-trips day + time through buildDt", () => {
        const dt = buildDt("2026-08-13", "07:00")
        expect(dt).toBe("2026-08-13T07:00:00")
        expect(dayKey(dt)).toBe("2026-08-13")
        expect(timeOf(dt)).toBe("07:00")
    })

    it("handles an early-morning time correctly (no TimeWheel 6am floor)", () => {
        const dt = buildDt("2026-08-13", "05:30")
        expect(timeOf(dt)).toBe("05:30")
    })
})

describe("sortItinerary", () => {
    it("sorts chronologically across days", () => {
        const items = [item("2026-08-14T07:00:00", "B"), item("2026-08-13T09:00:00", "A"), item("2026-08-13T07:00:00", "C")]
        expect(sortItinerary(items).map(i => i.label)).toEqual(["C", "A", "B"])
    })

    it("is stable for equal dt values", () => {
        const items = [item("2026-08-13T07:00:00", "first"), item("2026-08-13T07:00:00", "second")]
        expect(sortItinerary(items).map(i => i.label)).toEqual(["first", "second"])
    })

    it("does not mutate the input array", () => {
        const items = [item("2026-08-14T07:00:00", "B"), item("2026-08-13T07:00:00", "A")]
        const copy = [...items]
        sortItinerary(items)
        expect(items).toEqual(copy)
    })
})

describe("groupItineraryByDay", () => {
    it("groups into ordered day buckets regardless of input order", () => {
        const items = [
            item("2026-08-14T07:00:00", "Day2 item"),
            item("2026-08-13T09:00:00", "Day1 later"),
            item("2026-08-13T07:00:00", "Day1 earlier"),
        ]
        const groups = groupItineraryByDay(items)
        expect(groups.map(g => g.day)).toEqual(["2026-08-13", "2026-08-14"])
        expect(groups[0].items.map(i => i.label)).toEqual(["Day1 earlier", "Day1 later"])
        expect(groups[1].items.map(i => i.label)).toEqual(["Day2 item"])
    })

    it("returns an empty array for an empty itinerary", () => {
        expect(groupItineraryByDay([])).toEqual([])
    })
})

describe("replaceDay", () => {
    const base = [
        item("2026-08-13T07:00:00", "Day1 breakfast"),
        item("2026-08-13T09:00:00", "Day1 depart"),
        item("2026-08-14T08:00:00", "Day2 breakfast"),
    ]

    it("replaces an existing day's items and leaves other days untouched", () => {
        const result = replaceDay(base, "2026-08-13", [item("2026-08-13T06:30:00", "Day1 new time")])
        expect(result.map(i => i.label)).toEqual(["Day1 new time", "Day2 breakfast"])
        expect(result.find(i => i.label === "Day2 breakfast")).toEqual(base[2])
    })

    it("adds a brand new day", () => {
        const result = replaceDay(base, "2026-08-15", [item("2026-08-15T07:00:00", "Day3 breakfast")])
        expect(result.map(i => dayKey(i.dt))).toEqual(["2026-08-13", "2026-08-13", "2026-08-14", "2026-08-15"])
    })

    it("deletes a day when newItems is empty", () => {
        const result = replaceDay(base, "2026-08-13", [])
        expect(result.map(i => i.label)).toEqual(["Day2 breakfast"])
    })

    it("sorts the combined result", () => {
        const result = replaceDay(base, "2026-08-13", [item("2026-08-13T23:00:00", "late"), item("2026-08-13T05:00:00", "early")])
        expect(result.map(i => i.label)).toEqual(["early", "late", "Day2 breakfast"])
    })
})

describe("currentItineraryIndex", () => {
    // All `now` values are built with local-time constructors, and compared
    // against local no-suffix `dt` strings — never `Date` UTC maths — so
    // these pass regardless of the runner's own timezone.

    it("returns -1 when nothing has started yet", () => {
        const items = [item("2026-08-13T07:00:00", "A"), item("2026-08-13T12:00:00", "B")]
        expect(currentItineraryIndex(items, new Date(2026, 7, 13, 6, 0))).toBe(-1)
    })

    it("picks the earlier item when now falls between two items on the same day", () => {
        const items = [item("2026-08-13T07:00:00", "A"), item("2026-08-13T12:00:00", "B")]
        expect(currentItineraryIndex(items, new Date(2026, 7, 13, 9, 30))).toBe(0)
    })

    it("picks an item exactly at its start time", () => {
        const items = [item("2026-08-13T07:00:00", "A"), item("2026-08-13T12:00:00", "B")]
        expect(currentItineraryIndex(items, new Date(2026, 7, 13, 12, 0, 0))).toBe(1)
    })

    it("picks the last item on a day after it, while that day is still today", () => {
        const items = [item("2026-08-13T07:00:00", "A"), item("2026-08-13T12:00:00", "B")]
        expect(currentItineraryIndex(items, new Date(2026, 7, 13, 23, 0))).toBe(1)
    })

    it("returns -1 the day after the last item (it's no longer today)", () => {
        const items = [item("2026-08-13T07:00:00", "A"), item("2026-08-13T12:00:00", "B")]
        expect(currentItineraryIndex(items, new Date(2026, 7, 14, 9, 0))).toBe(-1)
    })

    it("returns -1 when a later day's first item hasn't started, even though an earlier day's items are past", () => {
        const items = [
            item("2026-08-13T07:00:00", "Day1 A"),
            item("2026-08-13T20:00:00", "Day1 B"),
            item("2026-08-14T07:00:00", "Day2 A"),
        ]
        // "Today" is day 2, but before its first item's start time.
        expect(currentItineraryIndex(items, new Date(2026, 7, 14, 6, 0))).toBe(-1)
    })

    it("resolves duplicate dt values to the last matching index", () => {
        const items = [
            item("2026-08-13T07:00:00", "tied-first"),
            item("2026-08-13T12:00:00", "earlier"),
            item("2026-08-13T07:00:00", "tied-second"),
        ]
        expect(currentItineraryIndex(items, new Date(2026, 7, 13, 7, 0))).toBe(2)
    })

    it("does not assume the list is sorted", () => {
        const items = [
            item("2026-08-13T12:00:00", "later"),
            item("2026-08-13T07:00:00", "earlier"),
        ]
        expect(currentItineraryIndex(items, new Date(2026, 7, 13, 9, 0))).toBe(1)
    })

    it("returns -1 for an empty list", () => {
        expect(currentItineraryIndex([], new Date(2026, 7, 13, 9, 0))).toBe(-1)
    })
})

describe("cleanStrings", () => {
    it("trims and drops blank entries", () => {
        expect(cleanStrings([" tent ", "", "   ", "sleeping bag"])).toEqual(["tent", "sleeping bag"])
    })
})

describe("validateItineraryDay", () => {
    it("accepts a well-formed day", () => {
        expect(validateItineraryDay("2026-08-13", [{ time: "07:00", label: "Breakfast", detail: "" }])).toBeNull()
    })

    it("rejects a malformed day string", () => {
        expect(validateItineraryDay("8/13/2026", [{ time: "07:00", label: "Breakfast", detail: "" }])).not.toBeNull()
    })

    it("rejects zero rows", () => {
        expect(validateItineraryDay("2026-08-13", [])).not.toBeNull()
    })

    it("rejects a missing time", () => {
        expect(validateItineraryDay("2026-08-13", [{ time: "", label: "Breakfast", detail: "" }])).not.toBeNull()
    })

    it("rejects a blank label", () => {
        expect(validateItineraryDay("2026-08-13", [{ time: "07:00", label: "   ", detail: "" }])).not.toBeNull()
    })

    it("rejects a label over the length cap", () => {
        expect(validateItineraryDay("2026-08-13", [{ time: "07:00", label: "x".repeat(201), detail: "" }])).not.toBeNull()
    })

    it("rejects a detail over the length cap", () => {
        expect(validateItineraryDay("2026-08-13", [{ time: "07:00", label: "Breakfast", detail: "x".repeat(2001) }])).not.toBeNull()
    })
})

describe("validatePackingCategory", () => {
    it("accepts a well-formed category", () => {
        expect(validatePackingCategory("Clothes", ["Shirt", "Socks"], ["Tools"])).toBeNull()
    })

    it("rejects a blank category name", () => {
        expect(validatePackingCategory("  ", ["Shirt"], [])).not.toBeNull()
    })

    it("rejects a category name over the length cap", () => {
        expect(validatePackingCategory("x".repeat(201), ["Shirt"], [])).not.toBeNull()
    })

    it("rejects a case-insensitive duplicate name", () => {
        expect(validatePackingCategory("clothes", ["Shirt"], ["Clothes"])).not.toBeNull()
    })

    it("tolerates blank item rows but requires at least one non-blank item", () => {
        expect(validatePackingCategory("Clothes", ["", "  ", "Shirt"], [])).toBeNull()
        expect(validatePackingCategory("Clothes", ["", "   "], [])).not.toBeNull()
    })

    it("rejects an item over the length cap", () => {
        expect(validatePackingCategory("Clothes", ["x".repeat(101)], [])).not.toBeNull()
    })
})

describe("saveErrorMessage", () => {
    const fallback = "Couldn't save the itinerary. Try again."

    function errorWithStatus(message: string, status: unknown): Error {
        return Object.assign(new Error(message), { status })
    }

    it("shows the backend detail for a 4xx error", () => {
        expect(saveErrorMessage(errorWithStatus("A day with this date already exists.", 400), fallback))
            .toBe("A day with this date already exists.")
        expect(saveErrorMessage(errorWithStatus("Not found", 404), fallback)).toBe("Not found")
        expect(saveErrorMessage(errorWithStatus("Conflict", 409), fallback)).toBe("Conflict")
    })

    it("falls back for a 5xx error instead of leaking the raw message", () => {
        expect(saveErrorMessage(errorWithStatus("HTTP 500", 500), fallback)).toBe(fallback)
    })

    it("falls back when there is no status at all (e.g. a network failure)", () => {
        expect(saveErrorMessage(new TypeError("Failed to fetch"), fallback)).toBe(fallback)
    })

    it("falls back for a thrown non-Error value", () => {
        expect(saveErrorMessage("boom", fallback)).toBe(fallback)
        expect(saveErrorMessage(null, fallback)).toBe(fallback)
        expect(saveErrorMessage(undefined, fallback)).toBe(fallback)
    })
})

describe("validateInstruction", () => {
    it("accepts a well-formed instruction", () => {
        expect(validateInstruction("Departure", "Meet at the school at 5am.")).toBeNull()
    })

    it("rejects a blank heading", () => {
        expect(validateInstruction("  ", "Body text")).not.toBeNull()
    })

    it("rejects a heading over the length cap", () => {
        expect(validateInstruction("x".repeat(201), "Body text")).not.toBeNull()
    })

    it("rejects a blank body", () => {
        expect(validateInstruction("Departure", "   ")).not.toBeNull()
    })

    it("rejects a body over the length cap", () => {
        expect(validateInstruction("Departure", "x".repeat(2001))).not.toBeNull()
    })
})
