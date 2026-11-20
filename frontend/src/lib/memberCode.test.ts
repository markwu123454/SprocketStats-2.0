import {describe, expect, it} from "vitest"
import {codeAt, codeHeader, importSecret, stepAt} from "./memberCode"

const NUMBER = 42
// bytes 0..31, the same secret backend/tests/test_member_codes.py uses.
const SECRET = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"

describe("memberCode", () => {
    it("matches the backend's codes for the same secret and step", async () => {
        const key = await importSecret(SECRET)
        expect(await codeAt(key, NUMBER, 179463961)).toBe("000042605876915828510742")
        expect(await codeAt(key, NUMBER, 179463962)).toBe("000042890758023363107329")
        expect(await codeAt(key, 9999, 179463961)).toBe("009999664936680702660784")
    })

    it("packs version and type into the 2-digit header like the backend", () => {
        expect(codeHeader(0, 0)).toBe("00")
        expect(codeHeader(0, 1)).toBe("01")
        expect(codeHeader(1, 0)).toBe("16")
        expect(codeHeader(3, 15)).toBe("63")
        expect(() => codeHeader(4, 0)).toThrow()
        expect(() => codeHeader(0, 16)).toThrow()
    })

    it("switches codes half a second after each boundary", () => {
        const rec = {clockOffsetMs: 0, stepSeconds: 10}
        // 1_000_000_000 ms is a boundary (10 s steps): step 100_000 starts there.
        expect(stepAt(1_000_000_400, rec).step).toBe(99_999)
        expect(stepAt(1_000_000_600, rec).step).toBe(100_000)
    })

    it("applies the saved clock offset", () => {
        // Phone 3 s slow: server time is 3 s ahead of Date.now().
        const rec = {clockOffsetMs: 3000, stepSeconds: 10}
        expect(stepAt(1_000_000_000 - 2000, rec).step).toBe(100_000)
    })
})
