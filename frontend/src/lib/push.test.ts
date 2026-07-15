// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"

import { getPushState, isPushSupported, subscribeToPush } from "./push"

// These tests exist because of a real crash: on a browser/PWA where push wasn't
// available, notification code got a null back and took the page down with it.
// push.ts now guards every one of those cases; this file pins that behaviour so
// a refactor can't quietly drop a guard and bring the crash back.
//
// jsdom gives us a window/navigator with NONE of the push APIs by default, which
// is exactly the "unsupported" browser we need to simulate. Each test that wants
// support present stubs the specific globals in.

function stubSupported(opts: {
    permission?: NotificationPermission
    subscription?: unknown
} = {}) {
    const { permission = "granted", subscription = null } = opts
    vi.stubGlobal("Notification", { permission })
    vi.stubGlobal("PushManager", class {})
    vi.stubGlobal("navigator", {
        serviceWorker: {
            ready: Promise.resolve({
                pushManager: { getSubscription: async () => subscription },
            }),
        },
    })
}

afterEach(() => {
    vi.unstubAllGlobals()
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
        stubSupported({ subscription: { endpoint: "https://example.com/sub" } })
        await expect(getPushState()).resolves.toBe("subscribed")
    })

    it("returns 'unsubscribed' when supported and permitted but not yet subscribed", async () => {
        stubSupported({ subscription: null })
        await expect(getPushState()).resolves.toBe("unsubscribed")
    })
})

describe("subscribeToPush", () => {
    it("rejects with a clear message rather than crashing when unsupported", async () => {
        await expect(subscribeToPush()).rejects.toThrow(/aren't supported/)
    })
})
