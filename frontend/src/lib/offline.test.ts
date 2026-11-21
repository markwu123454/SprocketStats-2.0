// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {
    OFFLINE_LOGIN_MS, checkSession, clearOfflineData, hasPendingLogout, lastOnlineAt, loadOfflineSnapshot,
    markOnline, pickOfflineKeys, saveOfflineSnapshot, setPendingLogout, updateOfflineSnapshot, withinOfflineWindow,
} from "./offline"

const API = "https://api.example.test"

function respond(status: number, body: unknown = {}) {
    return new Response(JSON.stringify(body), {status, headers: {"Content-Type": "application/json"}})
}

beforeEach(() => {
    localStorage.clear()
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
})

describe("offline window", () => {
    it("allows 30 days from the last time online, not a moment more", () => {
        const now = 1_800_000_000_000
        expect(withinOfflineWindow(now - OFFLINE_LOGIN_MS, now)).toBe(true)
        expect(withinOfflineWindow(now - OFFLINE_LOGIN_MS - 1, now)).toBe(false)
        expect(withinOfflineWindow(null, now)).toBe(false)
    })

    it("remembers when the phone was last online until cleared", () => {
        expect(lastOnlineAt()).toBeNull()
        markOnline(1234)
        expect(lastOnlineAt()).toBe(1234)
        clearOfflineData()
        expect(lastOnlineAt()).toBeNull()
    })
})

describe("saved bootstrap", () => {
    it("keeps only the offline keys, never control-panel data", () => {
        const picked = pickOfflineKeys({tasks: [1], members: [2], tag_assignments: {}, attendance_me: []})
        expect(picked).toEqual({tasks: [1], attendance_me: []})
    })

    it("only hands the snapshot back to the member it belongs to", () => {
        saveOfflineSnapshot("member-1", {meetings: ["m"], members: ["secret"]}, 99)
        expect(loadOfflineSnapshot("member-1")).toEqual({userId: "member-1", savedAt: 99, data: {meetings: ["m"]}})
        expect(loadOfflineSnapshot("member-2")).toBeNull()
        clearOfflineData()
        expect(loadOfflineSnapshot("member-1")).toBeNull()
    })

    it("takes a newer value for one key and keeps the rest and the saved time", () => {
        saveOfflineSnapshot("member-1", {tasks: ["old"], meetings: ["m"]}, 99)
        updateOfflineSnapshot("member-1", "tasks", ["fresh"], 500)
        expect(loadOfflineSnapshot("member-1")).toEqual({userId: "member-1", savedAt: 99, data: {tasks: ["fresh"], meetings: ["m"]}})
    })

    it("never saves a control-panel key from a page", () => {
        saveOfflineSnapshot("member-1", {meetings: ["m"]}, 99)
        updateOfflineSnapshot("member-1", "members", ["secret"])
        expect(loadOfflineSnapshot("member-1")?.data).toEqual({meetings: ["m"]})
    })

    it("starts a snapshot when the phone has none, or only another member's", () => {
        saveOfflineSnapshot("member-2", {meetings: ["theirs"]}, 99)
        updateOfflineSnapshot("member-1", "tasks", ["mine"], 500)
        expect(loadOfflineSnapshot("member-1")).toEqual({userId: "member-1", savedAt: 500, data: {tasks: ["mine"]}})
        expect(loadOfflineSnapshot("member-2")).toBeNull()
    })
})

describe("checkSession", () => {
    it("is offline without a request when the phone has no network", async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal("fetch", fetchMock)
        vi.spyOn(navigator, "onLine", "get").mockReturnValue(false)
        expect(await checkSession(API)).toEqual({kind: "unreachable", problem: "noNetwork"})
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it("treats a failed request as no connection", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))
        expect(await checkSession(API)).toEqual({kind: "unreachable", problem: "noNetwork"})
    })

    it("treats no answer within the limit as a slow connection", async () => {
        vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))
        })))
        expect(await checkSession(API, 20)).toEqual({kind: "unreachable", problem: "slow"})
    })

    it("treats a broken backend as unreachable, not signed out", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(503)))
        expect(await checkSession(API)).toEqual({kind: "unreachable", problem: "serverDown"})
    })

    it("tells signed in, signed out and blocked apart", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(200, {id: "member-1"})))
        expect(await checkSession(API)).toEqual({kind: "user", me: {id: "member-1"}})

        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(401)))
        expect(await checkSession(API)).toEqual({kind: "signedOut"})

        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(403, {detail: "Account pending approval"})))
        expect(await checkSession(API)).toEqual({kind: "blocked", detail: "Account pending approval"})
    })

    it("sends a sign-out made offline before checking, then forgets it", async () => {
        setPendingLogout()
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(respond(200))
            .mockResolvedValueOnce(respond(401))
        vi.stubGlobal("fetch", fetchMock)
        expect(await checkSession(API)).toEqual({kind: "signedOut"})
        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([`${API}/auth/logout`, `${API}/auth/me`])
        expect(hasPendingLogout()).toBe(false)
    })

    it("keeps a pending sign-out when it couldn't be sent", async () => {
        setPendingLogout()
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))
        expect(await checkSession(API)).toEqual({kind: "unreachable", problem: "noNetwork"})
        expect(hasPendingLogout()).toBe(true)
    })
})
