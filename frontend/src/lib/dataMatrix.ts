/**
 * Data Matrix (ECC 200) encoder for short ASCII payloads, enough for member
 * codes (42 digits -> a 20x20 symbol). Digit pairs pack into one codeword each,
 * which is why member codes are digits only.
 *
 * Follows ISO/IEC 16022: ASCII encodation, Reed-Solomon over GF(256) with the
 * 0x12D polynomial, and the standard module placement. Square symbols up to
 * 26x26 (a single data region) are supported.
 */

const EXP = new Array<number>(512)
const LOG = new Array<number>(256)
{
    let x = 1
    for (let i = 0; i < 255; i++) {
        EXP[i] = x
        LOG[x] = i
        x <<= 1
        if (x & 0x100) x ^= 0x12d
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]
}

function gmul(a: number, b: number): number {
    return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]
}

/** Error-correction codewords for `data` (generator roots 2^1..2^n). */
export function rsEcc(data: number[], n: number): number[] {
    let gen = [1]
    for (let i = 1; i <= n; i++) {
        const next = new Array<number>(gen.length + 1).fill(0)
        gen.forEach((c, j) => {
            next[j] ^= c
            next[j + 1] ^= gmul(c, EXP[i])
        })
        gen = next
    }
    let rem = new Array<number>(n).fill(0)
    for (const d of data) {
        const f = d ^ rem[0]
        rem = [...rem.slice(1), 0]
        for (let j = 0; j < n; j++) rem[j] ^= gmul(gen[j + 1], f)
    }
    return rem
}

// [symbol size, data codewords, error codewords]
const SIZES: [number, number, number][] = [
    [10, 3, 5], [12, 5, 7], [14, 8, 10], [16, 12, 12], [18, 18, 14],
    [20, 22, 18], [22, 30, 20], [24, 36, 24], [26, 44, 28],
]

const isDigit = (c: number) => c >= 48 && c <= 57

function encodeAscii(text: string): number[] {
    const out: number[] = []
    for (let i = 0; i < text.length;) {
        const c = text.charCodeAt(i)
        if (isDigit(c) && i + 1 < text.length && isDigit(text.charCodeAt(i + 1))) {
            out.push(130 + (c - 48) * 10 + (text.charCodeAt(i + 1) - 48))
            i += 2
        } else if (c < 128) {
            out.push(c + 1)
            i += 1
        } else {
            throw new Error("Data Matrix: only ASCII text is supported")
        }
    }
    return out
}

function pad(cws: number[], cap: number): number[] {
    const out = [...cws]
    if (out.length < cap) out.push(129)
    while (out.length < cap) {
        const p = out.length + 1
        let v = 129 + ((149 * p) % 253) + 1
        if (v > 254) v -= 254
        out.push(v)
    }
    return out
}

/** Module placement: each cell holds 10 * codeword + bit (1 = MSB), or 1 / 0 for the fixed corner. */
function place(nrow: number, ncol: number): number[][] {
    const arr = Array.from({length: nrow}, () => new Array<number>(ncol).fill(0))
    const module = (r: number, c: number, ch: number, bit: number) => {
        if (r < 0) {
            r += nrow
            c += 4 - ((nrow + 4) % 8)
        }
        if (c < 0) {
            c += ncol
            r += 4 - ((ncol + 4) % 8)
        }
        arr[r][c] = 10 * ch + bit
    }
    const cells = (ch: number, list: [number, number][]) => list.forEach(([r, c], i) => module(r, c, ch, i + 1))
    const utah = (r: number, c: number, ch: number) => cells(ch, [
        [r - 2, c - 2], [r - 2, c - 1], [r - 1, c - 2], [r - 1, c - 1], [r - 1, c], [r, c - 2], [r, c - 1], [r, c],
    ])
    const corner1 = (ch: number) => cells(ch, [
        [nrow - 1, 0], [nrow - 1, 1], [nrow - 1, 2], [0, ncol - 2], [0, ncol - 1], [1, ncol - 1], [2, ncol - 1], [3, ncol - 1],
    ])
    const corner2 = (ch: number) => cells(ch, [
        [nrow - 3, 0], [nrow - 2, 0], [nrow - 1, 0], [0, ncol - 4], [0, ncol - 3], [0, ncol - 2], [0, ncol - 1], [1, ncol - 1],
    ])
    const corner3 = (ch: number) => cells(ch, [
        [nrow - 3, 0], [nrow - 2, 0], [nrow - 1, 0], [0, ncol - 2], [0, ncol - 1], [1, ncol - 1], [2, ncol - 1], [3, ncol - 1],
    ])
    const corner4 = (ch: number) => cells(ch, [
        [nrow - 1, 0], [nrow - 1, ncol - 1], [0, ncol - 3], [0, ncol - 2], [0, ncol - 1], [1, ncol - 3], [1, ncol - 2], [1, ncol - 1],
    ])

    let ch = 1, row = 4, col = 0
    do {
        if (row === nrow && col === 0) corner1(ch++)
        if (row === nrow - 2 && col === 0 && ncol % 4) corner2(ch++)
        if (row === nrow - 2 && col === 0 && ncol % 8 === 4) corner3(ch++)
        if (row === nrow + 4 && col === 2 && !(ncol % 8)) corner4(ch++)
        do {
            if (row < nrow && col >= 0 && !arr[row][col]) utah(row, col, ch++)
            row -= 2
            col += 2
        } while (row >= 0 && col < ncol)
        row += 1
        col += 3
        do {
            if (row >= 0 && col < ncol && !arr[row][col]) utah(row, col, ch++)
            row += 2
            col -= 2
        } while (row < nrow && col >= 0)
        row += 3
        col += 1
    } while (row < nrow || col < ncol)
    if (!arr[nrow - 1][ncol - 1]) arr[nrow - 1][ncol - 1] = arr[nrow - 2][ncol - 2] = 1
    return arr
}

/** The symbol as rows of dark (true) / light modules, without a quiet zone. */
export function dataMatrix(text: string): boolean[][] {
    const data = encodeAscii(text)
    const spec = SIZES.find(([, cap]) => cap >= data.length)
    if (!spec) throw new Error("Data Matrix: text too long")
    const [size, cap, nec] = spec
    const cws = pad(data, cap)
    cws.push(...rsEcc(cws, nec))
    const n = size - 2
    const arr = place(n, n)
    const m = Array.from({length: size}, () => new Array<boolean>(size).fill(false))
    for (let r = 0; r < size; r++) {
        m[r][0] = true                                   // solid left edge
        m[r][size - 1] = (size - 1 - r) % 2 === 0         // right clock track
    }
    for (let c = 0; c < size; c++) {
        m[0][c] = c % 2 === 0                            // top clock track
        m[size - 1][c] = true                            // solid bottom edge
    }
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            const v = arr[r][c]
            m[r + 1][c + 1] = v === 1 ? true : v === 0 ? false : ((cws[Math.floor(v / 10) - 1] >> (8 - (v % 10))) & 1) === 1
        }
    }
    return m
}

/** SVG path for the dark modules, offset by `margin` modules of quiet zone. */
export function dataMatrixPath(m: boolean[][], margin = 2): string {
    const parts: string[] = []
    m.forEach((row, y) => {
        let x = 0
        while (x < row.length) {
            if (!row[x]) {
                x++
                continue
            }
            const start = x
            while (x < row.length && row[x]) x++
            parts.push(`M${start + margin} ${y + margin}h${x - start}v1h-${x - start}z`)
        }
    })
    return parts.join("")
}
