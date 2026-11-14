import {describe, expect, it} from "vitest"
import {codeAt, importSecret, stepAt} from "./memberCode"

const NUMBER = 42
// bytes 0..31, the same secret backend/tests/test_member_codes.py uses.
const SECRET = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"

describe("memberCode", () => {
    it("matches the backend's codes for the same secret and step", async () => {
        const key = await importSecret(SECRET)
        expect(await codeAt(key, NUMBER, 179463961)).toBe("0042853876120619")
        expect(await codeAt(key, NUMBER, 179463962)).toBe("0042226907458202")
        expect(await codeAt(key, 9999, 179463961)).toBe("9999332735996435")
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
