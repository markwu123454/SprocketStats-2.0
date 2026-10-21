// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"

import {
    getPushState,
    isPushSupported,
    subscribeToPush,
    syncPushSubscription,
    unsubscribeFromPush,
} from "./push"

// These tests exist because of a real crash: on a browser/PWA where push wasn't
// available, notification code got a null back and took the page down with it.
// push.ts now guards every one of those cases; this file pins that behaviour so
// a refactor can't quietly drop a guard and bring the crash back.
//
// jsdom gives us a window/navigator with NONE of the push APIs by default, which
// is exactly the "unsupported" browser we need to simulate. Each test that wants
// support present stubs the specific globals in.

interface FakeSubscription {
    endpoint: string
    toJSON: () => { endpoint: string; keys: { p256dh: string; auth: string } }
    unsubscribe: () => Promise<boolean>
}

function fakeSubscription(endpoint = "https://push.example/sub"): FakeSubscription {
    return {
        endpoint,
        toJSON: () => ({ endpoint, keys: { p256dh: "p", auth: "a" } }),
        unsubscribe: vi.fn(async () => true),
    }
}

function stubSupported(opts: {
    permission?: NotificationPermission
    requestResult?: NotificationPermission
    subscription?: FakeSubscription | null
    ready?: Promise<unknown>
    fetchOk?: boolean
} = {}) {
    const { permission = "granted", requestResult = permission, fetchOk = true } = opts
    let current: FakeSubscription | null = opts.subscription ?? null

    const requestPermission = vi.fn(async () => requestResult)
    const subscribe = vi.fn(async () => {
        current = fakeSubscription("https://push.example/new")
        return current
    })
    const pushManager = { getSubscription: async () => current, subscribe }
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>(
        async (url) => ({
            ok: fetchOk,
            json: async () => (url.endsWith("/push/public-key") ? { public_key: "AQID" } : { ok: true }),
        }),
    )

    vi.stubGlobal("Notification", { permission, requestPermission })
    vi.stubGlobal("PushManager", class {})
    vi.stubGlobal("navigator", {
        serviceWorker: { ready: opts.ready ?? Promise.resolve({ pushManager }) },
    })
    vi.stubGlobal("fetch", fetchMock)

    /** Parsed bodies of every POST /push/subscribe made so far. */
    const postedSubscribe = () =>
        fetchMock.mock.calls
            .filter(([url]) => url.endsWith("/push/subscribe"))
            .map(([, init]) => JSON.parse(String(init?.body)) as { endpoint: string })
    return { requestPermission, subscribe, fetchMock, postedSubscribe }
}

afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    localStorage.clear()
})

describe("isPushSupported", () => {
    it("is false when the platform APIs are absent (PWA not installed / unsupported browser)", () => {
        expect(isPushSupported()).toBe(false)
    })

    it("is true only when serviceWorker, PushManager and Notification all exist", () => {
        stubSupported()
        expect(isPushSupported()).toBe(true)
    })
})

describe("getPushState", () => {
    it("returns 'unsupported' instead of throwing when push isn't available", async () => {
        // The original crash lived here: reading navigator.serviceWorker when it
        // didn't exist. The guard must short-circuit to 'unsupported' first.
        await expect(getPushState()).resolves.toBe("unsupported")
    })

    it("returns 'denied' when the user has blocked notifications", async () => {
        stubSupported({ permission: "denied" })
        await expect(getPushState()).resolves.toBe("denied")
    })

    it("returns 'subscribed' when a subscription already exists", async () => {
        stubSupported({ subscription: fakeSubscription() })
        await expect(getPushState()).resolves.toBe("subscribed")
    })

    it("returns 'unsubscribed' when supported and permitted but not yet subscribed", async () => {
        stubSupported({ subscription: null })
        await expect(getPushState()).resolves.toBe("unsubscribed")
    })

    it("resolves to 'unsupported' instead of hanging when no service worker ever becomes ready", async () => {
        // e.g. the dev server, where the PWA plugin's worker is disabled:
        // serviceWorker.ready never settles.
        vi.useFakeTimers()
        stubSupported({ ready: new Promise(() => {}) })
        const state = getPushState()
        await vi.advanceTimersByTimeAsync(10_000)
        await expect(state).resolves.toBe("unsupported")
    })
})

describe("syncPushSubscription", () => {
    it("does nothing and reports 'unsupported' when push isn't available", async () => {
        await expect(syncPushSubscription()).resolves.toBe("unsupported")
    })

    it("never prompts: permission not yet granted means no subscribe and no network", async () => {
        const { requestPermission, subscribe, fetchMock } = stubSupported({ permission: "default" })
        await expect(syncPushSubscription()).resolves.toBe("unsubscribed")
        expect(requestPermission).not.toHaveBeenCalled()
        expect(subscribe).not.toHaveBeenCalled()
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it("reports 'denied' without touching the push manager when blocked", async () => {
        const { subscribe, fetchMock } = stubSupported({ permission: "denied" })
        await expect(syncPushSubscription()).resolves.toBe("denied")
        expect(subscribe).not.toHaveBeenCalled()
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it("re-posts an existing local subscription so the server can't silently lose it", async () => {
        const { subscribe, postedSubscribe } = stubSupported({ subscription: fakeSubscription() })
        await expect(syncPushSubscription()).resolves.toBe("subscribed")
        expect(subscribe).not.toHaveBeenCalled()
        expect(postedSubscribe()).toHaveLength(1)
        expect(postedSubscribe()[0]).toEqual({
            endpoint: "https://push.example/sub",
            keys: { p256dh: "p", auth: "a" },
        })
    })

    it("resubscribes when permission is granted but the subscription is gone", async () => {
        const { subscribe, postedSubscribe } = stubSupported({ subscription: null })
        await expect(syncPushSubscription()).resolves.toBe("subscribed")
        expect(subscribe).toHaveBeenCalledOnce()
        expect(postedSubscribe()[0]?.endpoint).toBe("https://push.example/new")
    })

    it("doesn't resubscribe a device the user turned off in Settings", async () => {
        const stub = stubSupported({ subscription: fakeSubscription() })
        await unsubscribeFromPush()

        // Permission is still "granted" after an unsubscribe.
        const { subscribe } = stubSupported({ subscription: null })
        await expect(syncPushSubscription()).resolves.toBe("unsubscribed")
        expect(subscribe).not.toHaveBeenCalled()
        expect(stub.fetchMock).toHaveBeenCalled()
    })

    it("turning push back on clears that opt-out", async () => {
        stubSupported({ subscription: fakeSubscription() })
        await unsubscribeFromPush()
        stubSupported({ subscription: null })
        await subscribeToPush()

        const { subscribe } = stubSupported({ subscription: null })
        await expect(syncPushSubscription()).resolves.toBe("subscribed")
        expect(subscribe).toHaveBeenCalledOnce()
    })

    it("never throws when the server is unreachable", async () => {
        stubSupported({ subscription: fakeSubscription(), fetchOk: false })
        await expect(syncPushSubscription()).resolves.toBe("subscribed")

        stubSupported({ subscription: null, fetchOk: false })
        await expect(syncPushSubscription()).resolves.toBe("unsubscribed")
    })
})

describe("subscribeToPush", () => {
    it("rejects with a clear message rather than crashing when unsupported", async () => {
        await expect(subscribeToPush()).rejects.toThrow(/aren't supported/)
    })

    it("rejects without subscribing when the prompt is denied", async () => {
        const { subscribe, fetchMock } = stubSupported({ permission: "default", requestResult: "denied" })
        await expect(subscribeToPush()).rejects.toThrow(/not granted/)
        expect(subscribe).not.toHaveBeenCalled()
        expect(fetchMock).not.toHaveBeenCalled()
    })
})
