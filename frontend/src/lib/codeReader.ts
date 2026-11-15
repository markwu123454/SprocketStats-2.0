/**
 * Reads a member's rotating code (see memberCode.ts) out of a camera frame.
 * The decoder is zxing-cpp compiled to WebAssembly, loaded on first use and
 * served from our own bundle rather than its default CDN.
 */
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url"

const MEMBER_CODE_RE = /^\d{16}$/

type Reader = typeof import("zxing-wasm/reader")
let reader: Promise<Reader> | null = null

function loadReader(): Promise<Reader> {
    reader ??= import("zxing-wasm/reader").then(m => {
        m.prepareZXingModule({
            overrides: {locateFile: (path, prefix) => (path.endsWith(".wasm") ? wasmUrl : prefix + path)},
        })
        return m
    })
    return reader
}

/** Start downloading the decoder ahead of the first frame. */
export function preloadCodeReader(): void {
    void loadReader()
}

/** The 16-digit member code in `frame`, or null if there isn't one. */
export async function readMemberCode(frame: ImageData): Promise<string | null> {
    const {readBarcodes} = await loadReader()
    const results = await readBarcodes(frame, {formats: ["DataMatrix"], tryHarder: true, maxNumberOfSymbols: 1})
    const text = results.find(r => r.isValid)?.text.trim()
    return text && MEMBER_CODE_RE.test(text) ? text : null
}
