// @vitest-environment jsdom
import { act, createElement, type Dispatch, type SetStateAction } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"

import { BootstrapContext, BootstrapLatestContext, createBootstrapLatest, useBootstrapped } from "./bootstrapContext"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mounted: Root[] = []

afterEach(() => {
    for (const root of mounted.splice(0)) act(() => root.unmount())
})

/** Mounts a page reading `key`; returns what it renders and its setter. */
function mountPage(cache: Record<string, unknown>, latest: ReturnType<typeof createBootstrapLatest>, key = "tasks") {
    const out: { value?: unknown, set?: Dispatch<SetStateAction<unknown>> } = {}
    function Page() {
        const [value, set] = useBootstrapped<unknown>(key, "initial")
        out.value = value
        out.set = set
        return null
    }
    const root = createRoot(document.createElement("div"))
    mounted.push(root)
    act(() => root.render(
        createElement(BootstrapContext.Provider, { value: cache },
            createElement(BootstrapLatestContext.Provider, { value: latest }, createElement(Page))),
    ))
    return { out, unmount: () => act(() => root.unmount()) }
}

describe("useBootstrapped", () => {
    it("starts from the bootstrap snapshot when no page has fetched the key yet", () => {
        const page = mountPage({ tasks: "from app load" }, createBootstrapLatest())
        expect(page.out.value).toBe("from app load")
    })

    it("starts from what the last page fetched, not the snapshot from app load", () => {
        const latest = createBootstrapLatest()
        const first = mountPage({ tasks: "from app load" }, latest)
        act(() => first.out.set!("fresh from the server"))
        first.unmount()

        const again = mountPage({ tasks: "from app load" }, latest)

        expect(again.out.value).toBe("fresh from the server")
    })

    it("keeps changes made on the page for the next visit", () => {
        const latest = createBootstrapLatest()
        const first = mountPage({ tasks: ["a"] }, latest)
        act(() => first.out.set!((prev: unknown) => [...(prev as string[]), "b"]))
        first.unmount()

        expect(mountPage({ tasks: ["a"] }, latest).out.value).toEqual(["a", "b"])
    })

    it("doesn't record a value the page only read", () => {
        const latest = createBootstrapLatest()
        mountPage({ tasks: "from app load" }, latest).unmount()
        expect(latest.has("tasks")).toBe(false)
    })

    it("goes back to the snapshot once a fresh bootstrap clears the latest values", () => {
        const latest = createBootstrapLatest()
        const first = mountPage({ tasks: "old" }, latest)
        act(() => first.out.set!("fetched"))
        first.unmount()

        latest.clear() // what BootstrapProvider does when a new /bootstrap arrives
        expect(mountPage({ tasks: "new bootstrap" }, latest).out.value).toBe("new bootstrap")
    })

    it("tells the provider about each value a page records, for the offline copy", () => {
        const heard: [string, unknown][] = []
        const latest = createBootstrapLatest((key, value) => heard.push([key, value]))
        const page = mountPage({ tasks: "from app load" }, latest)
        expect(heard).toEqual([]) // only reading records nothing

        act(() => page.out.set!("fresh"))

        expect(heard).toEqual([["tasks", "fresh"]])
    })

    it("keeps each key separate", () => {
        const latest = createBootstrapLatest()
        const tasks = mountPage({ tasks: "t0", events: "e0" }, latest, "tasks")
        act(() => tasks.out.set!("t1"))

        expect(mountPage({ tasks: "t0", events: "e0" }, latest, "events").out.value).toBe("e0")
    })
})
