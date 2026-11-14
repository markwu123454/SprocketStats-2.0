/**
 * The member's rotating code: 16 digits (4-digit code number + 12-digit tag)
 * shown as a 14x14 Data Matrix and read by a kiosk's camera. Mirrors
 * backend/core/member_codes.py.
 *
 * The secret is downloaded once while signed in and online, imported as a
 * non-extractable WebCrypto key (the page can sign with it but nothing can read
 * it back) and kept in IndexedDB, so the code keeps working with no signal.
 * The server's time is saved alongside it to correct the phone's clock.
 */

const API = import.meta.env.VITE_BACKEND_URL

const DB_NAME = "sprocket-member-code"
const STORE = "keys"
const RECORD = "current"

// Switch codes half a second after each step boundary. The server accepts the
// current step and the previous one for 1 s after the rotation, so this
// centres every code in its window (+-0.5 s of clock error either way).
const SWITCH_DELAY_MS = 500

export interface MemberCodeKey {
    memberId: string
    codeNumber: number
    version: number
    key: CryptoKey
    stepSeconds: number
    clockOffsetMs: number
    savedAt: number
}

/** Thrown when the server says this account can't have a member code. */
export class MemberCodeUnavailable extends Error {}

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1)
        req.onupgradeneeded = () => req.result.createObjectStore(STORE)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
    })
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await openDb()
    try {
        return await new Promise<T>((resolve, reject) => {
            const req = run(db.transaction(STORE, mode).objectStore(STORE))
            req.onsuccess = () => resolve(req.result)
            req.onerror = () => reject(req.error)
        })
    } finally {
        db.close()
    }
}

function base64UrlToBytes(b64: string): Uint8Array<ArrayBuffer> {
    const s = b64.replace(/-/g, "+").replace(/_/g, "/")
    const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4))
    return Uint8Array.from(bin, ch => ch.charCodeAt(0))
}

export function importSecret(b64: string): Promise<CryptoKey> {
    return crypto.subtle.importKey("raw", base64UrlToBytes(b64), {name: "HMAC", hash: "SHA-256"}, false, ["sign"])
}

/** The 16-digit code for one time step. */
export async function codeAt(key: CryptoKey, codeNumber: number, step: number): Promise<string> {
    const number = String(codeNumber).padStart(4, "0")
    const sig = new Uint8Array(
        await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`SSID2|${number}|${step}`)),
    )
    let n = 0n
    for (let i = 0; i < 8; i++) n = (n << 8n) | BigInt(sig[i])
    return number + (n % 10n ** 12n).toString().padStart(12, "0")
}

/** Which step to show at `nowMs`, and how far into it we are (for the timer bar). */
export function stepAt(nowMs: number, rec: Pick<MemberCodeKey, "clockOffsetMs" | "stepSeconds">) {
    const stepMs = rec.stepSeconds * 1000
    const t = nowMs + rec.clockOffsetMs - SWITCH_DELAY_MS
    const step = Math.floor(t / stepMs)
    return {step, fraction: (t - step * stepMs) / stepMs}
}

/** The stored key, if it belongs to `memberId`. */
export async function loadMemberCodeKey(memberId: string): Promise<MemberCodeKey | null> {
    try {
        const rec = await withStore<MemberCodeKey | undefined>("readonly", s => s.get(RECORD))
        // Keys saved before code numbers existed have none: treat as missing.
        return rec && rec.memberId === memberId && typeof rec.codeNumber === "number" ? rec : null
    } catch {
        return null
    }
}

/** Download (or refresh) this member's key and clock offset. Needs a signed-in, online session. */
export async function syncMemberCodeKey(): Promise<MemberCodeKey> {
    const sentAt = Date.now()
    const res = await fetch(`${API}/attendance/code_key`, {credentials: "include", cache: "no-store"})
    const receivedAt = Date.now()
    if (res.status === 409) throw new MemberCodeUnavailable("This account can't use a member code")
    if (!res.ok) throw new Error(`code_key failed: ${res.status}`)
    const body = await res.json() as {
        member_id: string, code_number: number, version: number, secret: string, step_seconds: number,
        server_time: number,
    }
    const rec: MemberCodeKey = {
        memberId: body.member_id,
        codeNumber: body.code_number,
        version: body.version,
        key: await importSecret(body.secret),
        stepSeconds: body.step_seconds,
        clockOffsetMs: body.server_time * 1000 - (sentAt + receivedAt) / 2,
        savedAt: receivedAt,
    }
    await withStore("readwrite", s => s.put(rec, RECORD))
    return rec
}

/** Forget the key on this device (sign-out, account change). */
export async function clearMemberCodeKey(): Promise<void> {
    try {
        await withStore("readwrite", s => s.delete(RECORD))
    } catch {
        // Nothing stored or storage unavailable: nothing to clear.
    }
}
