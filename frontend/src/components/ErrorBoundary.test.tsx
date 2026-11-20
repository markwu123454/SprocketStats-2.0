// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MemoryRouter, Route, Routes, useNavigate, type NavigateFunction } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import PageErrorBoundary from "./ErrorBoundary"
import * as chunkRecovery from "@/lib/chunkRecovery"

vi.mock("@/lib/chunkRecovery", async importOriginal => ({
    ...await importOriginal<typeof import("@/lib/chunkRecovery")>(),
    canRecoverFromChunkError: vi.fn(() => true),
    recoverFromChunkError: vi.fn(async () => true),
    clearChunkRecovery: vi.fn(),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLElement | null = null
let navigate: NavigateFunction | null = null

function Crash(): never {
    // Like the dashboard reading a field the offline profile doesn't have.
    throw new TypeError("Cannot read properties of undefined (reading 'length')")
}

function ChunkFails(): never {
    // What a lazy page throws when the server hands back HTML for its chunk.
    throw new TypeError("Failed to fetch dynamically imported module: https://www.sprocketstats.com/assets/MeetingPage-DITQa8xH.js")
}

function Navigator() {
    navigate = useNavigate()
    return null
}

function mount(path: string) {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root!.render(
        createElement(MemoryRouter, { initialEntries: [path] },
            createElement("p", null, "Top bar"),
            createElement(Navigator),
            createElement(PageErrorBoundary, null,
                createElement(Routes, null,
                    createElement(Route, { path: "/crash", element: createElement(Crash) }),
                    createElement(Route, { path: "/stale", element: createElement(ChunkFails) }),
                    createElement(Route, { path: "/fine", element: createElement("p", null, "Fine page") }),
                ),
            ),
        ),
    ))
}

beforeEach(() => {
    // React reports every caught error to console.error; keep the output clean.
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.clearAllMocks()
    vi.mocked(chunkRecovery.canRecoverFromChunkError).mockReturnValue(true)
    vi.mocked(chunkRecovery.recoverFromChunkError).mockResolvedValue(true)
})

afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    root = null
    host = null
    navigate = null
    vi.restoreAllMocks()
})

describe("PageErrorBoundary", () => {
    it("renders the page when nothing goes wrong", () => {
        mount("/fine")
        expect(host!.textContent).toContain("Fine page")
        expect(host!.textContent).not.toContain("couldn't load")
    })

    it("shows a message instead of going blank when a page crashes", () => {
        mount("/crash")
        expect(host!.textContent).toContain("This page couldn't load")
        expect(host!.querySelector("button")?.textContent).toBe("Reload")
        // Everything outside the boundary (the app shell) is still there.
        expect(host!.textContent).toContain("Top bar")
    })

    it("recovers when the member goes to another page", () => {
        mount("/crash")
        act(() => void navigate!("/fine"))
        expect(host!.textContent).toContain("Fine page")
        expect(host!.textContent).not.toContain("couldn't load")
    })

    it("doesn't try chunk recovery for an ordinary crash", () => {
        mount("/crash")
        expect(chunkRecovery.recoverFromChunkError).not.toHaveBeenCalled()
    })
})

describe("PageErrorBoundary with a page whose code won't load", () => {
    it("reloads onto the current build instead of showing the error", async () => {
        mount("/stale")
        await act(async () => {})
        expect(chunkRecovery.recoverFromChunkError).toHaveBeenCalledOnce()
        expect(host!.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("Loading the latest version")
        expect(host!.textContent).not.toContain("couldn't load")
    })

    it("shows the error when recovery gives up (e.g. offline)", async () => {
        vi.mocked(chunkRecovery.recoverFromChunkError).mockResolvedValue(false)
        mount("/stale")
        await act(async () => {})
        expect(host!.textContent).toContain("This page couldn't load")
    })

    it("shows the error straight away when no recovery step is left", () => {
        vi.mocked(chunkRecovery.canRecoverFromChunkError).mockReturnValue(false)
        mount("/stale")
        expect(host!.textContent).toContain("This page couldn't load")
        expect(chunkRecovery.recoverFromChunkError).not.toHaveBeenCalled()
    })

    it("lets a manual Reload start recovery over", () => {
        vi.mocked(chunkRecovery.canRecoverFromChunkError).mockReturnValue(false)
        mount("/stale")
        act(() => host!.querySelector("button")!.click())
        expect(chunkRecovery.clearChunkRecovery).toHaveBeenCalledOnce()
    })
})
