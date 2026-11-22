import { describe, expect, it } from "vitest"

import { syncViewportVars, watchViewport } from "./viewport"

type Listener = () => void

/** A window with just what the viewport helpers touch, recording the CSS variables they write. */
function fakeWindow(viewport: { height: number, offsetTop: number } | null, innerHeight = 844) {
    const vars = new Map<string, string>()
    const winListeners = new Map<string, Listener>()
    const vvListeners = new Map<string, Listener>()
    const visualViewport = viewport && {
        ...viewport,
        addEventListener: (type: string, fn: Listener) => { vvListeners.set(type, fn) },
        removeEventListener: (type: string) => { vvListeners.delete(type) },
    }
    const win = {
        innerHeight,
        visualViewport,
        document: { documentElement: { style: { setProperty: (name: string, value: string) => { vars.set(name, value) } } } },
        addEventListener: (type: string, fn: Listener) => { winListeners.set(type, fn) },
        removeEventListener: (type: string) => { winListeners.delete(type) },
    }
    return { win: win as unknown as Window, vars, visualViewport, vvListeners, winListeners }
}

describe("syncViewportVars", () => {
    it("tracks how far iOS slid the view down for an open keyboard", () => {
        const { win, vars } = fakeWindow({ height: 420, offsetTop: 300 })
        syncViewportVars(win)
        expect(vars.get("--real-vh")).toBe("420px")
        expect(vars.get("--vv-top")).toBe("300px")
    })

    it("keeps the page height while the keyboard shrinks the on-screen area", () => {
        const { win, vars } = fakeWindow({ height: 420, offsetTop: 300 }, 844)
        syncViewportVars(win)
        expect(vars.get("--app-vh")).toBe("844px")
    })

    it("ignores the negative offset of a rubber-band bounce", () => {
        const { win, vars } = fakeWindow({ height: 844, offsetTop: -12 })
        syncViewportVars(win)
        expect(vars.get("--vv-top")).toBe("0px")
    })

    it("falls back to the window height without a visual viewport", () => {
        const { win, vars } = fakeWindow(null, 700)
        syncViewportVars(win)
        expect(vars.get("--real-vh")).toBe("700px")
        expect(vars.get("--vv-top")).toBe("0px")
    })
})

describe("watchViewport", () => {
    it("follows the view as Safari slides it, then stops listening", () => {
        const { win, vars, visualViewport, vvListeners, winListeners } = fakeWindow({ height: 844, offsetTop: 0 })
        const stop = watchViewport(win)
        expect(vars.get("--vv-top")).toBe("0px")

        // Keyboard opens: the view shrinks, then slides down to the focused field.
        visualViewport!.height = 420
        vvListeners.get("resize")!()
        visualViewport!.offsetTop = 260
        vvListeners.get("scroll")!()
        expect(vars.get("--real-vh")).toBe("420px")
        expect(vars.get("--vv-top")).toBe("260px")
        expect(vars.get("--app-vh")).toBe("844px")

        stop()
        expect(vvListeners.size).toBe(0)
        expect(winListeners.size).toBe(0)
    })
})
