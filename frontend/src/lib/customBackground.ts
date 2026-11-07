// User-uploaded app background. The (downscaled) image lives in IndexedDB since
// it is too big for localStorage; the dim level lives in localStorage.
// Applied by overriding --theme-bg-page on <html>, which every page background
// already reads. Removing the override restores the season's default.

const DB_NAME = "app-custom-bg"
const STORE = "kv"
const IMAGE_KEY = "image"
const DIM_KEY = "app-custom-bg-dim"
const ENABLED_KEY = "app-custom-bg-enabled"
const MAX_DIM = 0.8
const MAX_EDGE = 2560

let objectUrl: string | null = null

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1)
        req.onupgradeneeded = () => req.result.createObjectStore(STORE)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
    })
}

async function idbGet(): Promise<Blob | null> {
    const db = await openDb()
    return new Promise((resolve, reject) => {
        const req = db.transaction(STORE).objectStore(STORE).get(IMAGE_KEY)
        req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null)
        req.onerror = () => reject(req.error)
    })
}

async function idbSet(blob: Blob | null): Promise<void> {
    const db = await openDb()
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite")
        const store = tx.objectStore(STORE)
        if (blob) store.put(blob, IMAGE_KEY)
        else store.delete(IMAGE_KEY)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
    })
}

export function getBackgroundDim(): number {
    const n = Number(localStorage.getItem(DIM_KEY))
    return Number.isFinite(n) ? Math.min(Math.max(n, 0), MAX_DIM) : 0.3
}

export function isCustomBackgroundEnabled(): boolean {
    return localStorage.getItem(ENABLED_KEY) === "true"
}

function paint(blob: Blob | null, dim: number) {
    const root = document.documentElement
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null }
    if (!blob) {
        root.style.removeProperty("--theme-bg-page")
        return
    }
    objectUrl = URL.createObjectURL(blob)
    const shade = `rgba(0,0,0,${dim})`
    root.style.setProperty("--theme-bg-page", `linear-gradient(${shade},${shade}), url("${objectUrl}") center / cover no-repeat`)
}

/** Re-apply the stored background (or the default if none / disabled). */
export async function applyCustomBackground(): Promise<boolean> {
    try {
        if (!isCustomBackgroundEnabled()) { paint(null, 0); return false }
        const blob = await idbGet()
        paint(blob, getBackgroundDim())
        return !!blob
    } catch {
        paint(null, 0)
        return false
    }
}

async function downscale(file: File): Promise<Blob> {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    return new Promise((resolve, reject) =>
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error("Could not process image"))), "image/jpeg", 0.88))
}

export async function setCustomBackground(file: File): Promise<void> {
    if (!file.type.startsWith("image/")) throw new Error("Please choose an image file")
    const blob = await downscale(file)
    await idbSet(blob)
    localStorage.setItem(ENABLED_KEY, "true")
    paint(blob, getBackgroundDim())
}

/** Switch back to the default season background and delete the stored image. */
export async function resetCustomBackground(): Promise<void> {
    localStorage.setItem(ENABLED_KEY, "false")
    paint(null, 0)
    try { await idbSet(null) } catch { /* nothing stored */ }
}

export async function setBackgroundDim(dim: number): Promise<void> {
    localStorage.setItem(DIM_KEY, String(dim))
    if (isCustomBackgroundEnabled()) await applyCustomBackground()
}

export const BACKGROUND_MAX_DIM = MAX_DIM
