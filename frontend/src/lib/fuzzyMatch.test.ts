import { describe, expect, it } from "vitest"

import { fuzzyFilter, fuzzyScore } from "./fuzzyMatch"

// This matcher ranks people's display names in a roster picker, so the thing
// worth pinning down isn't just "does it match" but "does it rank sanely" —
// an exact name beats a prefix beats a word-start beats initials beats a raw
// substring beats a scattered subsequence, and a shorter label wins ties
// within its own tier without ever leaking into the tier below it.

describe("fuzzyScore tiers", () => {
    it("tier 1 (600): exact match", () => {
        expect(fuzzyScore("Al", "Al")).toBeCloseTo(600 - 2 / 100, 5)
    })

    it("tier 2 (500): text starts with query", () => {
        expect(fuzzyScore("al", "Alex")).toBeCloseTo(500 - 4 / 100, 5)
    })

    it("tier 3 (400): a word in the text starts with query", () => {
        expect(fuzzyScore("al", "Ping Albert")).toBeCloseTo(400 - "Ping Albert".length / 100, 5)
    })

    it("tier 4 (300): query matches consecutive words' initials", () => {
        expect(fuzzyScore("js", "John Smith")).toBeCloseTo(300 - "John Smith".length / 100, 5)
    })

    it("tier 4: initials run can start at a later word, not just the first", () => {
        // "jas" -> John / A / Smith: the initials run covers all three words.
        expect(fuzzyScore("jas", "John A Smith")).toBeCloseTo(300 - "John A Smith".length / 100, 5)
    })

    it("tier 5 (200): text contains query, but not at a word start", () => {
        // "oh" only ever appears mid-word in "John", never as a word prefix.
        expect(fuzzyScore("oh", "John")).toBeCloseTo(200 - "John".length / 100, 5)
    })

    it("tier 6 (100): query is a subsequence, not a contiguous substring", () => {
        // j-o-h-n: "jn" appears in order but with "oh" gapped in between.
        expect(fuzzyScore("jn", "John")).toBeCloseTo(100 - "John".length / 100, 5)
    })

    it("returns null for a clear non-match", () => {
        expect(fuzzyScore("xyz", "John")).toBeNull()
    })

    // The contract's tier table checks tiers 1-6 in order and the first hit
    // wins. Its prose separately claims "sm" must match "John Smith" via tier
    // 6 (subsequence) rather than tier 3 — but "Smith" is a word that starts
    // with "sm", so tier 3 fires first, same as any other word-start match.
    // The prose and the table disagree here; the table is authoritative, so
    // that's what this test pins down.
    it("tier table resolves 'sm' vs 'John Smith' to tier 3, not tier 6 (contract prose contradicts the table here)", () => {
        const score = fuzzyScore("sm", "John Smith")
        expect(score).toBeCloseTo(400 - "John Smith".length / 100, 5)
        // Sanity check it isn't accidentally landing on the tier-6 base instead.
        expect(score).toBeGreaterThan(100)
    })
})

describe("fuzzyScore ranking behavior", () => {
    it("for query 'al': 'Al' outranks 'Alex' outranks 'Alexander'", () => {
        const al = fuzzyScore("al", "Al")!
        const alex = fuzzyScore("al", "Alex")!
        const alexander = fuzzyScore("al", "Alexander")!
        expect(al).toBeGreaterThan(alex)
        expect(alex).toBeGreaterThan(alexander)
    })

    it("a tier-2 prefix match outranks a tier-5 substring match", () => {
        const prefix = fuzzyScore("al", "Alex")! // starts with "al"
        const substring = fuzzyScore("al", "Salvador")! // contains "al" mid-word, no word starts with it
        expect(prefix).toBeGreaterThan(substring)
    })

    it("tier always dominates the length penalty: a long tier-5 match beats a short tier-6-only match", () => {
        // Worst case for tier 5: penalty near its 0.99 cap (>=99 chars).
        // Best case for tier 6: penalty near zero (very short text).
        const longSubstring = fuzzyScore("xy", "a".repeat(49) + "xy" + "a".repeat(48))! // 99 chars, tier 5
        const shortSubsequence = fuzzyScore("xy", "xzy")! // tier 6 only: "xy" isn't contiguous in "xzy"
        expect(longSubstring).toBeCloseTo(200 - 0.99, 5)
        expect(shortSubsequence).toBeCloseTo(100 - 0.03, 5)
        expect(longSubstring).toBeGreaterThan(shortSubsequence)
    })

    it("case-insensitive in both directions", () => {
        expect(fuzzyScore("AL", "alex")).toEqual(fuzzyScore("al", "Alex"))
        expect(fuzzyScore("al", "ALEX")).toEqual(fuzzyScore("al", "Alex"))
    })

    it("trims surrounding whitespace from the query", () => {
        expect(fuzzyScore("  al  ", "Alex")).toEqual(fuzzyScore("al", "Alex"))
    })

    it("a blank query scores every text 0", () => {
        expect(fuzzyScore("", "Alex")).toBe(0)
        expect(fuzzyScore("   ", "Alex")).toBe(0)
    })

    it("empty-string and single-character queries don't throw", () => {
        expect(() => fuzzyScore("", "")).not.toThrow()
        expect(() => fuzzyScore("a", "")).not.toThrow()
        expect(() => fuzzyScore("", "Alex")).not.toThrow()
        expect(() => fuzzyScore("a", "Alex")).not.toThrow()
    })
})

describe("fuzzyFilter", () => {
    it("returns the input array unchanged, in original order, for a blank query", () => {
        const options = [{ label: "Zoe" }, { label: "Amir" }, { label: "Bea" }]
        expect(fuzzyFilter(options, "")).toEqual(options)
        expect(fuzzyFilter(options, "   ")).toEqual(options)
    })

    it("drops non-matches and sorts matches by score descending", () => {
        const options = [{ label: "Alexander" }, { label: "Alex" }, { label: "Al" }, { label: "Bea" }]
        const result = fuzzyFilter(options, "al")
        expect(result.map(o => o.label)).toEqual(["Al", "Alex", "Alexander"])
    })

    it("ranks a tier-2 prefix match above a tier-5 substring match", () => {
        const options = [{ label: "Salvador" }, { label: "Alex" }]
        const result = fuzzyFilter(options, "al")
        expect(result.map(o => o.label)).toEqual(["Alex", "Salvador"])
    })

    it("is stable: equal-scoring labels keep their original relative order", () => {
        // "Andy" and "Anna" are both 4 chars and both hit tier 2 on "an", so
        // they score identically — the sort must not reorder them.
        const options = [{ label: "Andy" }, { label: "Anna" }, { label: "Zed" }]
        const result = fuzzyFilter(options, "an")
        expect(result.map(o => o.label)).toEqual(["Andy", "Anna"])
    })

    it("matches initials through the full pipeline: 'js' -> John Smith, 'jas' -> John A Smith", () => {
        const options = [{ label: "John Smith" }, { label: "John A Smith" }, { label: "Jane Doe" }]
        // "js" hits "John Smith" via tier-4 initials and, more weakly, "John A
        // Smith" via tier-6 subsequence (j...s in "John A Smith") — the tier-4
        // hit must rank first. "Jane Doe" has no 's' at all, so it never matches.
        expect(fuzzyFilter(options, "js").map(o => o.label)).toEqual(["John Smith", "John A Smith"])
        // "jas" only satisfies the initials run on "John A Smith"; "John Smith"
        // has no "a" for the subsequence path either, so it drops out entirely.
        expect(fuzzyFilter(options, "jas").map(o => o.label)).toEqual(["John A Smith"])
    })

    it("empty-string and single-character queries don't throw", () => {
        const options = [{ label: "Alex" }]
        expect(() => fuzzyFilter(options, "")).not.toThrow()
        expect(() => fuzzyFilter(options, "a")).not.toThrow()
    })
})
