import {readFileSync} from "node:fs"
import {createRequire} from "node:module"
import {describe, expect, it} from "vitest"
import {prepareZXingModule, readBarcodes} from "zxing-wasm/reader"
import {dataMatrix, rsEcc} from "./dataMatrix"

// The same decoder the kiosks run, loaded from node_modules instead of a CDN.
prepareZXingModule({
    overrides: {wasmBinary: readFileSync(createRequire(import.meta.url).resolve("zxing-wasm/reader/zxing_reader.wasm"))},
})

/** Render a symbol as RGBA pixels: `scale` px per module, 2-module quiet zone. */
function render(m: boolean[][], scale = 8) {
    const side = (m.length + 4) * scale
    const data = new Uint8ClampedArray(side * side * 4).fill(255)
    m.forEach((row, y) => row.forEach((dark, x) => {
        if (!dark) return
        for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
                const i = (((y + 2) * scale + dy) * side + (x + 2) * scale + dx) * 4
                data[i] = data[i + 1] = data[i + 2] = 0
            }
        }
    }))
    return {data, width: side, height: side, colorSpace: "srgb" as const}
}

describe("dataMatrix", () => {
    it("matches the standard's worked example for error correction", () => {
        // ISO/IEC 16022: "123456" in a 10x10 symbol.
        expect(rsEcc([142, 164, 186], 5)).toEqual([114, 25, 5, 88, 102])
    })

    it("encodes a 24-digit member code as a 16x16 symbol the kiosk decoder reads back", async () => {
        const code = "000042605876915828510742"
        const m = dataMatrix(code)
        expect(m.length).toBe(16)
        expect(m.every(row => row.length === 16)).toBe(true)
        const results = await readBarcodes(render(m), {formats: ["DataMatrix"], tryHarder: true})
        expect(results.map(r => r.text)).toEqual([code])
    })

    it("encodes 16 digits as a 14x14 symbol", () => {
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
