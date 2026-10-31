// @vitest-environment jsdom
import { createElement, act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const confirmDialog = vi.fn<(o: unknown) => Promise<boolean>>()
vi.mock("./confirmDialog", () => ({ confirmDialog: (o: unknown) => confirmDialog(o) }))

import { askDiscard, confirmAnyDiscard, isDirtyVs, shouldGuardClick, useDiscardGuard } from "./useDiscardGuard"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLElement | null = null

function mount(dirty: boolean) {
    const out: { confirm?: () => Promise<boolean> } = {}
    function Probe({ d }: { d: boolean }) {
        out.confirm = useDiscardGuard(d)
        return null
    }
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root!.render(createElement(Probe, { d: dirty })))
    return {
        out,
        set: (d: boolean) => act(() => root!.render(createElement(Probe, { d }))),
    }
}

beforeEach(() => confirmDialog.mockReset())
afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    root = null
    host = null
})

describe("isDirtyVs", () => {
    it("compares by value", () => {
        expect(isDirtyVs({ a: [1] }, { a: [1] })).toBe(false)
        expect(isDirtyVs({ a: [1] }, { a: [2] })).toBe(true)
    })
})

describe("askDiscard", () => {
    it("asks with the Discard changes copy and shares one open prompt", async () => {
        let resolve!: (v: boolean) => void
        confirmDialog.mockReturnValue(new Promise<boolean>(r => { resolve = r }))
        const a = askDiscard()
        const b = askDiscard()
        expect(confirmDialog).toHaveBeenCalledTimes(1)
        expect(confirmDialog).toHaveBeenCalledWith({ title: "Discard changes?", body: "Your edits will be lost.", confirmLabel: "Discard", danger: true })
        resolve(false)
        expect(await a).toBe(false)
        expect(await b).toBe(false)
        confirmDialog.mockResolvedValue(true)
        expect(await askDiscard()).toBe(true)
        expect(confirmDialog).toHaveBeenCalledTimes(2)
    })
})

describe("useDiscardGuard", () => {
    it("resolves true without prompting when clean", async () => {
        const { out } = mount(false)
        expect(await out.confirm!()).toBe(true)
        expect(confirmDialog).not.toHaveBeenCalled()
        expect(await confirmAnyDiscard()).toBe(true)
    })

    it("prompts when dirty and returns the answer", async () => {
        const { out } = mount(true)
        confirmDialog.mockResolvedValueOnce(false)
        expect(await out.confirm!()).toBe(false)
        confirmDialog.mockResolvedValueOnce(true)
        expect(await out.confirm!()).toBe(true)
    })

    it("follows dirty going back to false", async () => {
        const { out, set } = mount(true)
        set(false)
        expect(await out.confirm!()).toBe(true)
        expect(confirmDialog).not.toHaveBeenCalled()
    })

    it("arms beforeunload only while dirty", () => {
        const { set } = mount(false)
        const fire = () => {
            const e = new Event("beforeunload", { cancelable: true })
            window.dispatchEvent(e)
            return e.defaultPrevented
        }
        expect(fire()).toBe(false)
        set(true)
        expect(fire()).toBe(true)
        set(false)
        expect(fire()).toBe(false)
    })

    it("holds back an in-app link click, asks once, and follows it on Discard", async () => {
        mount(true)
        mount(true) // a second dirty form must not double-prompt
        const a = document.createElement("a")
        a.href = "/elsewhere"
        let followed = 0
        a.addEventListener("click", e => { e.preventDefault(); followed++ })
        document.body.appendChild(a)
        confirmDialog.mockResolvedValue(true)
        a.click()
        expect(followed).toBe(0)
        await vi.waitFor(() => expect(followed).toBe(1))
        expect(confirmDialog).toHaveBeenCalledTimes(1)
        a.remove()
    })
})

describe("shouldGuardClick", () => {
    const loc = { href: "http://x.test/a", origin: "http://x.test", pathname: "/a", search: "" } as Location
    const anchor = (href: string, attrs: Record<string, string> = {}) => {
        const a = document.createElement("a")
        a.href = href
        Object.entries(attrs).forEach(([k, v]) => a.setAttribute(k, v))
        return a
    }
    const click = (init: MouseEventInit = {}) => new MouseEvent("click", { button: 0, cancelable: true, ...init })

    it("guards plain same-origin navigation", () => {
        expect(shouldGuardClick(click(), anchor("http://x.test/b"), loc)).toBe(true)
    })
    it("ignores modified clicks, new tabs, downloads, other origins and the same page", () => {
        expect(shouldGuardClick(click({ ctrlKey: true }), anchor("http://x.test/b"), loc)).toBe(false)
        expect(shouldGuardClick(click({ button: 1 }), anchor("http://x.test/b"), loc)).toBe(false)
        expect(shouldGuardClick(click(), anchor("http://x.test/b", { target: "_blank" }), loc)).toBe(false)
        expect(shouldGuardClick(click(), anchor("http://x.test/b", { download: "" }), loc)).toBe(false)
        expect(shouldGuardClick(click(), anchor("http://other.test/b"), loc)).toBe(false)
        expect(shouldGuardClick(click(), anchor("http://x.test/a#top"), loc)).toBe(false)
        expect(shouldGuardClick(click(), null, loc)).toBe(false)
    })
})
