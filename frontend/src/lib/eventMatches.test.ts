import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getAlliance, matchLabel, nextMatchFor } from "./eventMatches"
import type { TBAMatch } from "./eventApi"

const TEAM = "frc3473"

function buildMatch(overrides: Partial<TBAMatch> & { key: string }): TBAMatch {
    return {
        comp_level: "qm",
        set_number: 1,
        match_number: 1,
        alliances: {
            red: { team_keys: [], score: 0 },
            blue: { team_keys: [], score: 0 },
        },
        winning_alliance: "",
        scheduled_time: null,
        predicted_time: null,
        actual_time: null,
        post_result_time: null,
        ...overrides,
    }
}

describe("getAlliance", () => {
    it("finds the team on red", () => {
        const m = buildMatch({ key: "m1", alliances: { red: { team_keys: [TEAM], score: 0 }, blue: { team_keys: ["frc1"], score: 0 } } })
        expect(getAlliance(m, TEAM)).toBe("red")
    })

    it("finds the team on blue", () => {
        const m = buildMatch({ key: "m1", alliances: { red: { team_keys: ["frc1"], score: 0 }, blue: { team_keys: [TEAM], score: 0 } } })
        expect(getAlliance(m, TEAM)).toBe("blue")
    })

    it("returns null when the team isn't in the match", () => {
        const m = buildMatch({ key: "m1", alliances: { red: { team_keys: ["frc1"], score: 0 }, blue: { team_keys: ["frc2"], score: 0 } } })
        expect(getAlliance(m, TEAM)).toBeNull()
    })
})

describe("matchLabel", () => {
    it("qualification match", () => {
        expect(matchLabel(buildMatch({ key: "m1", comp_level: "qm", match_number: 12 }))).toBe("Qual 12")
    })

    it("semifinal match includes set and match number", () => {
        expect(matchLabel(buildMatch({ key: "m1", comp_level: "sf", set_number: 2, match_number: 3 }))).toBe("Semi 2M3")
    })

    it("final match", () => {
        expect(matchLabel(buildMatch({ key: "m1", comp_level: "f", match_number: 1 }))).toBe("Final M1")
    })

    it("falls back to a generic label for any other comp level", () => {
        expect(matchLabel(buildMatch({ key: "m1", comp_level: "qf", match_number: 4 }))).toBe("qf 4")
    })
})

describe("nextMatchFor", () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date(2026, 2, 21, 12, 0, 0))
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    const nowUnix = Date.now() / 1000

    it("skips matches that have already been played (actual_time set)", () => {
        const played = buildMatch({
            key: "played",
            alliances: { red: { team_keys: [TEAM], score: 10 }, blue: { team_keys: ["frc1"], score: 5 } },
            actual_time: nowUnix - 60,
            predicted_time: nowUnix - 120,
        })
        expect(nextMatchFor([played], TEAM)).toBeNull()
    })

    it("skips matches that don't involve the team", () => {
        const other = buildMatch({
            key: "other",
            alliances: { red: { team_keys: ["frc1"], score: 0 }, blue: { team_keys: ["frc2"], score: 0 } },
            predicted_time: nowUnix + 600,
        })
        expect(nextMatchFor([other], TEAM)).toBeNull()
    })

    it("picks the earliest upcoming match by predicted_time (falling back to scheduled_time)", () => {
        const later = buildMatch({
            key: "later",
            alliances: { red: { team_keys: [TEAM], score: 0 }, blue: { team_keys: ["frc1"], score: 0 } },
            predicted_time: nowUnix + 1800,
        })
        const sooner = buildMatch({
            key: "sooner",
            alliances: { red: { team_keys: [TEAM], score: 0 }, blue: { team_keys: ["frc2"], score: 0 } },
            scheduled_time: nowUnix + 300, // no predicted_time -- falls back to scheduled_time
        })
        const result = nextMatchFor([later, sooner], TEAM)
        expect(result?.key).toBe("sooner")
    })

    it("returns null when there is no upcoming match for the team", () => {
        expect(nextMatchFor([], TEAM)).toBeNull()
    })
})
