/**
 * The ONLY module allowed to touch the notification / push platform APIs
 * (`Notification`, `navigator.serviceWorker`, `PushManager`). Every page and
 * component must go through the guarded helpers exported here — never call those
 * globals directly.
 *
 * Why: those APIs return null / throw when the PWA isn't installed, permission
 * isn't granted, or the browser doesn't support push. Funnelling all access
 * through this one guarded surface is what stops "notification returned None"
 * from crashing a page. An ESLint rule (see eslint.config.js) enforces this
 * boundary so a new page physically can't reintroduce that crash, and push.test.ts
 * pins the guard behaviour so a refactor can't quietly remove it.
 */

const API = import.meta.env.VITE_BACKEND_URL

/** Decode a base64url (no padding) VAPID key into the raw bytes `applicationServerKey` expects. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
    const rawData = atob(base64)
    return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)))
}

export function isPushSupported(): boolean {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window
}

export type PushState = "unsupported" | "denied" | "subscribed" | "unsubscribed"

/** Current push state for this browser, without prompting for anything. */
export async function getPushState(): Promise<PushState> {
    if (!isPushSupported()) return "unsupported"
    if (Notification.permission === "denied") return "denied"

    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    return subscription ? "subscribed" : "unsubscribed"
}

/**
 * Request notification permission (must be called from a user gesture, e.g. a
 * button click) and register this browser with both the push service and the
 * backend. Throws with a user-facing message on any failure.
 */
export async function subscribeToPush(): Promise<void> {
    if (!isPushSupported()) {
        throw new Error("Push notifications aren't supported in this browser")
    }

    const permission = await Notification.requestPermission()
    if (permission !== "granted") {
        throw new Error("Notification permission was not granted")
    }

    const keyRes = await fetch(`${API}/push/public-key`, { credentials: "include" })
    if (!keyRes.ok) throw new Error("Failed to reach the server")
    const { public_key: publicKey } = (await keyRes.json()) as { public_key: string | null }
    if (!publicKey) throw new Error("Push notifications aren't configured on the server yet")

    const registration = await navigator.serviceWorker.ready
    const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey),
        }))

    const json = subscription.toJSON()
    const res = await fetch(`${API}/push/subscribe`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
    })
    if (!res.ok) throw new Error("Failed to save your subscription")
}

/** Unsubscribe this browser from push, both locally and on the backend. */
export async function unsubscribeFromPush(): Promise<void> {
    if (!isPushSupported()) return

    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    if (!subscription) return

    const endpoint = subscription.endpoint
    await subscription.unsubscribe()

    await fetch(`${API}/push/unsubscribe`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint }),
    })
}
