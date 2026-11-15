import { prepareZXingModule, readBarcodes, type ReaderOptions } from "zxing-wasm/reader"
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url"
import type { FoundCode, WorkerRequest, WorkerResponse } from "./codeReader"

// Decodes camera frames off the main thread. One frame at a time: the scanner
// only sends the next frame after this one answers. Same decoder setup as the
// kiosk's reader.

// Load the decoder from the app bundle instead of the jsDelivr CDN.
prepareZXingModule({
    overrides: {
        locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path),
    },
})

const OPTIONS: ReaderOptions = {
    formats: ["DataMatrix"],
    tryHarder: true,
    tryRotate: true,
    tryInvert: false,
    tryDownscale: true,
    maxNumberOfSymbols: 8,
    // A code that's found but can't be read (blur, glare) still tells the
    // scanner the phone hasn't left, so one flickering frame isn't a new scan.
    returnErrors: true,
}

const scope = self as unknown as {
    onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null
    postMessage: (message: WorkerResponse) => void
}

let canvas: OffscreenCanvas | null = null
let context: OffscreenCanvasRenderingContext2D | null = null

scope.onmessage = async ({ data: { bitmap, capturedAt } }) => {
    const { width, height } = bitmap
    let codes: FoundCode[] = []
    try {
        if (!canvas || canvas.width !== width || canvas.height !== height) {
            canvas = new OffscreenCanvas(width, height)
            context = canvas.getContext("2d", { willReadFrequently: true })
        }
        if (context) {
            context.drawImage(bitmap, 0, 0)
            const results = await readBarcodes(context.getImageData(0, 0, width, height), OPTIONS)
            codes = results.map(r => ({
                text: r.isValid ? r.text : null,
                quad: [r.position.topLeft, r.position.topRight, r.position.bottomRight, r.position.bottomLeft],
            }))
        }
    } catch {
        codes = []
    } finally {
        bitmap.close()
    }
    scope.postMessage({ capturedAt, width, height, codes })
}
