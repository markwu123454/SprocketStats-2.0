import { beforeEach, describe, expect, it, vi } from "vitest"
import {
    RECOVERY_WINDOW_MS, canRecoverFromChunkError, clearChunkRecovery, isChunkLoadError, nextRecoveryStep,
    recoverFromChunkError, resetRecoveryForTests, type RecoveryDeps, type RecoveryState,
} from "./chunkRecovery"

const NOW = 1_700_000_000_000

function fakeDeps(start: RecoveryState | null, overrides: Partial<RecoveryDeps> = {}) {
    let state = start
    const deps = {
        now: () => NOW,
        load: () => state,
        save: vi.fn((s: RecoveryState | null) => { state = s }),
        activateWaitingWorker: vi.fn(async () => {}),
        siteReachable: vi.fn(async () => true),
        resetServiceWorker: vi.fn(async () => {}),
        reload: vi.fn(),
        ...overrides,
    }
    return { deps, state: () => state }
}

beforeEach(() => resetRecoveryForTests())

describe("isChunkLoadError", () => {
    it.each([
        "Failed to fetch dynamically imported module: https://www.sprocketstats.com/assets/MeetingPage-DITQa8xH.js",
        "error loading dynamically imported module: https://example.com/assets/a.js",
        "Importing a module script failed.",
        "Unable to preload CSS for /assets/index-abc.css",
    ])("recognises %s", message => {
        expect(isChunkLoadError(new TypeError(message))).toBe(true)
    })

    it("leaves ordinary crashes alone", () => {
        expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'length')"))).toBe(false)
        expect(isChunkLoadError(null)).toBe(false)
        expect(isChunkLoadError("Failed to fetch dynamically imported module: x.js")).toBe(true)
    })
})

describe("nextRecoveryStep", () => {
    it("reloads first, resets if that didn't help, then gives up", () => {
        expect(nextRecoveryStep(null, NOW)).toBe("reload")
        expect(nextRecoveryStep({ step: 1, at: NOW - 5_000 }, NOW)).toBe("reset")
        expect(nextRecoveryStep({ step: 2, at: NOW - 5_000 }, NOW)).toBe("give-up")
    })

    it("starts over once the last attempt is old", () => {
        expect(nextRecoveryStep({ step: 2, at: NOW - RECOVERY_WINDOW_MS - 1 }, NOW)).toBe("reload")
    })
})

describe("recoverFromChunkError", () => {
    it("first reloads, after handing over to a waiting service worker", async () => {
        const { deps, state } = fakeDeps(null)
        await expect(recoverFromChunkError(deps)).resolves.toBe(true)
        expect(deps.activateWaitingWorker).toHaveBeenCalledOnce()
        expect(deps.reload).toHaveBeenCalledOnce()
        expect(deps.resetServiceWorker).not.toHaveBeenCalled()
        expect(state()).toEqual({ step: 1, at: NOW })
    })

    it("still reloads when the waiting worker can't be reached", async () => {
        const { deps } = fakeDeps(null, { activateWaitingWorker: vi.fn(async () => { throw new Error("no SW") }) })
        await expect(recoverFromChunkError(deps)).resolves.toBe(true)
        expect(deps.reload).toHaveBeenCalledOnce()
    })

    it("drops the service worker and its caches when the reload didn't help", async () => {
        const { deps, state } = fakeDeps({ step: 1, at: NOW - 3_000 })
        await expect(recoverFromChunkError(deps)).resolves.toBe(true)
        expect(deps.resetServiceWorker).toHaveBeenCalledOnce()
        expect(deps.reload).toHaveBeenCalledOnce()
        expect(state()).toEqual({ step: 2, at: NOW })
    })

    it("keeps the offline copy when the site can't be reached", async () => {
        const { deps, state } = fakeDeps({ step: 1, at: NOW - 3_000 }, { siteReachable: vi.fn(async () => false) })
        await expect(recoverFromChunkError(deps)).resolves.toBe(false)
        expect(deps.resetServiceWorker).not.toHaveBeenCalled()
        expect(deps.reload).not.toHaveBeenCalled()
        expect(state()).toEqual({ step: 1, at: NOW - 3_000 })
    })

    it("treats a failed reachability check as offline", async () => {
        const { deps } = fakeDeps({ step: 1, at: NOW - 3_000 }, { siteReachable: vi.fn(async () => { throw new TypeError("Failed to fetch") }) })
        await expect(recoverFromChunkError(deps)).resolves.toBe(false)
        expect(deps.resetServiceWorker).not.toHaveBeenCalled()
    })

    it("gives up after both steps", async () => {
        const { deps } = fakeDeps({ step: 2, at: NOW - 3_000 })
        await expect(recoverFromChunkError(deps)).resolves.toBe(false)
        expect(deps.reload).not.toHaveBeenCalled()
    })

    it("runs once per page load, however many pages fail", async () => {
        const { deps } = fakeDeps(null)
        const results = await Promise.all([recoverFromChunkError(deps), recoverFromChunkError(deps)])
        expect(results).toEqual([true, true])
        expect(deps.reload).toHaveBeenCalledOnce()
        expect(deps.resetServiceWorker).not.toHaveBeenCalled()
    })
})

describe("canRecoverFromChunkError / clearChunkRecovery", () => {
    it("reports whether a step is left, and a manual retry starts over", () => {
        const { deps, state } = fakeDeps({ step: 2, at: NOW - 1_000 })
        expect(canRecoverFromChunkError(deps)).toBe(false)
        clearChunkRecovery(deps)
        expect(state()).toBeNull()
        expect(canRecoverFromChunkError(deps)).toBe(true)
    })
})
