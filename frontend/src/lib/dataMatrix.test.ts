import {describe, expect, it} from "vitest"
import {dataMatrix, rsEcc} from "./dataMatrix"

describe("dataMatrix", () => {
    it("matches the standard's worked example for error correction", () => {
        // ISO/IEC 16022: "123456" in a 10x10 symbol.
        expect(rsEcc([142, 164, 186], 5)).toEqual([114, 25, 5, 88, 102])
    })

    it("encodes a 16-digit member code as a 14x14 symbol", () => {
        // From the independent Python reference encoder.
        const expected = [
            "10101010101010",
            "11011110100101",
            "11011100000010",
            "11000010001001",
            "10101101011010",
            "10001111000101",
            "10110110110100",
            "10100000010101",
            "10001001010000",
            "10001000110011",
            "10110100010010",
            "11010001101101",
            "11001000101000",
            "11111111111111",
        ]
        const m = dataMatrix("0042853876120619")
        expect(m.map(row => row.map(b => (b ? "1" : "0")).join(""))).toEqual(expected)
    })

    it("encodes 42 digits as a 20x20 symbol", () => {
        // Same grid as the reference encoder used for the design mockups.
        const expected = [
            "10101010101010101010",
            "11010100110011110101",
            "10001001001110100000",
            "11101111000101110101",
            "11111110001000111110",
            "11100101011100000011",
            "10001010101000011110",
            "11011011100110100001",
            "11101110110001010010",
            "11001001111000110101",
            "11011001001000111000",
            "11001001010010011101",
            "11111011000000101010",
            "10010010001111110101",
            "10011011101101011100",
            "10011100010011100101",
            "10101110101111110010",
            "11111100010110000101",
            "10101111101010001010",
            "11111111111111111111",
        ]
        const m = dataMatrix("110483726195531042881703231750235036243581")
        expect(m.map(row => row.map(b => (b ? "1" : "0")).join(""))).toEqual(expected)
    })

    it("draws the L-shaped finder and clock tracks", () => {
        const m = dataMatrix("12")
        const n = m.length
        for (let i = 0; i < n; i++) {
            expect(m[i][0]).toBe(true)
            expect(m[n - 1][i]).toBe(true)
            expect(m[0][i]).toBe(i % 2 === 0)
        }
    })

    it("rejects payloads it can't fit", () => {
        expect(() => dataMatrix("1".repeat(100))).toThrow()
    })
})
