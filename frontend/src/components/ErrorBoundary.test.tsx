// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MemoryRouter, Route, Routes, useNavigate, type NavigateFunction } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import PageErrorBoundary from "./ErrorBoundary"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLElement | null = null
let navigate: NavigateFunction | null = null

function Crash(): never {
    // Like the dashboard reading a field the offline profile doesn't have.
    throw new TypeError("Cannot read properties of undefined (reading 'length')")
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
                    createElement(Route, { path: "/fine", element: createElement("p", null, "Fine page") }),
                ),
            ),
        ),
    ))
}

beforeEach(() => {
    // React reports every caught error to console.error; keep the output clean.
    vi.spyOn(console, "error").mockImplementation(() => {})
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
})
