/**
 * Reads members' rotating codes (see memberCode.ts) out of camera frames.
 * The decoder is zxing-cpp compiled to WebAssembly, served from our own bundle
 * rather than its default CDN. It runs in a Web Worker (codeReader.worker.ts)
 * so decoding never stalls the camera preview; browsers without
 * OffscreenCanvas fall back to decoding on the main thread with the same options.
 */
import type { ReaderOptions } from "zxing-wasm/reader"
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url"

const MEMBER_CODE_RE = /^\d{16}$/

export interface Point {
    x: number
    y: number
}

export interface FoundCode {
    /** Decoded text, or null when a code was found but couldn't be read. */
    text: string | null
    /** Corners in frame pixels: top-left, top-right, bottom-right, bottom-left. */
    quad: Point[]
}

export interface WorkerRequest {
    bitmap: ImageBitmap
    capturedAt: number
}

export interface WorkerResponse {
    capturedAt: number
    width: number
    height: number
    codes: FoundCode[]
}

/** A valid 16-digit member code, else null (any other DataMatrix is ignored). */
export function memberCodeOf(text: string | null): string | null {
    const t = text?.trim()
    return t && MEMBER_CODE_RE.test(t) ? t : null
}

/** Centre of a code's corners, for telling codes in the same frame apart. */
export function centerOf(quad: Point[]): Point {
    const n = quad.length || 1
    return { x: quad.reduce((s, p) => s + p.x, 0) / n, y: quad.reduce((s, p) => s + p.y, 0) / n }
}

export interface CodeReader {
    /** Decode one frame. Takes ownership of `bitmap` (it is closed afterwards). */
    read(bitmap: ImageBitmap, capturedAt: number): Promise<WorkerResponse>
    close(): void
}

// ── main-thread fallback ─────────────────────────────────────────────────────

const FALLBACK_OPTIONS: ReaderOptions = {
    formats: ["DataMatrix"],
    tryHarder: true,
    tryRotate: true,
    tryInvert: false,
    tryDownscale: true,
    maxNumberOfSymbols: 8,
    returnErrors: true,
}

type Reader = typeof import("zxing-wasm/reader")
let mainThreadReader: Promise<Reader> | null = null

function loadMainThreadReader(): Promise<Reader> {
    mainThreadReader ??= import("zxing-wasm/reader").then(m => {
        m.prepareZXingModule({
            overrides: { locateFile: (path, prefix) => (path.endsWith(".wasm") ? wasmUrl : prefix + path) },
        })
        return m
    })
    return mainThreadReader
}

function mainThreadCodeReader(): CodeReader {
    const canvas = document.createElement("canvas")
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    void loadMainThreadReader()
    return {
        async read(bitmap, capturedAt) {
            const { width, height } = bitmap
            try {
                if (!ctx) return { capturedAt, width, height, codes: [] }
                canvas.width = width
                canvas.height = height
                ctx.drawImage(bitmap, 0, 0)
                const { readBarcodes } = await loadMainThreadReader()
                const results = await readBarcodes(ctx.getImageData(0, 0, width, height), FALLBACK_OPTIONS)
                return {
                    capturedAt, width, height,
                    codes: results.map(r => ({
                        text: r.isValid ? r.text : null,
                        quad: [r.position.topLeft, r.position.topRight, r.position.bottomRight, r.position.bottomLeft],
                    })),
                }
            } catch {
                return { capturedAt, width, height, codes: [] }
            } finally {
                bitmap.close()
            }
        },
        close() {},
    }
}

// ── worker ───────────────────────────────────────────────────────────────────

function workerCodeReader(): CodeReader {
    const worker = new Worker(new URL("./codeReader.worker.ts", import.meta.url), { type: "module" })
    // One frame in flight at a time, so a single pending resolver is enough.
    let pending: ((r: WorkerResponse) => void) | null = null
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const resolve = pending
        pending = null
        resolve?.(e.data)
    }
    worker.onerror = () => {
        const resolve = pending
        pending = null
        resolve?.({ capturedAt: 0, width: 0, height: 0, codes: [] })
    }
    return {
        read(bitmap, capturedAt) {
            return new Promise(resolve => {
                pending = resolve
                worker.postMessage({ bitmap, capturedAt } satisfies WorkerRequest, [bitmap])
            })
        },
        close() {
            pending = null
            worker.terminate()
        },
    }
}

/** A decoder for a scanning session; call `close()` when the scanner closes. */
export function createCodeReader(): CodeReader {
    const canWork = typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined"
    if (canWork) {
        try {
            return workerCodeReader()
        } catch {
            // Module workers unsupported: decode on the main thread instead.
        }
    }
    return mainThreadCodeReader()
}
