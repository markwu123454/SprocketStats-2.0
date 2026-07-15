import { describe, expect, it } from "vitest"

import { can, getPerm, type PermPolicy } from "./permissions"

// The whole contract of getPerm/can is "read nested policy without ever throwing
// on a missing branch". These tests pin that down so a refactor that reintroduces
// a crash-on-missing-path (the class of UI crash these helpers exist to prevent)
// fails in CI instead of in a user's browser.

const policy: PermPolicy = {
    control_panel: { view: true, edit: false },
    subteam: "software",
}

describe("getPerm", () => {
    it("reads a nested value by dotted path", () => {
        expect(getPerm(policy, "control_panel.view")).toBe(true)
        expect(getPerm(policy, "subteam")).toBe("software")
    })

    it("returns undefined for a missing branch instead of throwing", () => {
        expect(getPerm(policy, "control_panel.delete")).toBeUndefined()
        expect(getPerm(policy, "nope.also_nope.deep")).toBeUndefined()
    })

    it("is null-safe when the whole policy is absent", () => {
        expect(getPerm(null, "control_panel.view")).toBeUndefined()
        expect(getPerm(undefined, "anything")).toBeUndefined()
    })
})

describe("can", () => {
    it("returns the boolean verdict at a path", () => {
        expect(can(policy, "control_panel.view")).toBe(true)
        expect(can(policy, "control_panel.edit")).toBe(false)
    })

    it("treats a missing path or absent policy as false", () => {
        expect(can(policy, "control_panel.delete")).toBe(false)
        expect(can(null, "control_panel.view")).toBe(false)
    })
})
