import { describe, expect, it } from "vitest"

import { ASSIGNABLE_ROLES, ROSTER_ROLES, rosterRoleLabel, validatePhone } from "./rosterRoles"

describe("ROSTER_ROLES", () => {
    it("lists all seven roles in the roster grid's existing sort order", () => {
        expect(ROSTER_ROLES.map(r => r.value)).toEqual([
            "mentor", "chaperone", "captain", "lead", "drive_team", "pit_crew", "attending",
        ])
    })
})

describe("ASSIGNABLE_ROLES", () => {
    it("is the four roles assignable via check-in or the roster's role editor, 'attending' first as the check-in form's default", () => {
        expect(ASSIGNABLE_ROLES.map(r => r.value)).toEqual(["attending", "drive_team", "pit_crew", "mentor"])
    })
})

describe("rosterRoleLabel", () => {
    it("labels every known role exactly as the roster grid showed it before this change", () => {
        expect(rosterRoleLabel("mentor")).toBe("Mentor")
        expect(rosterRoleLabel("chaperone")).toBe("Chaperone")
        expect(rosterRoleLabel("captain")).toBe("Captain")
        expect(rosterRoleLabel("lead")).toBe("Lead")
        expect(rosterRoleLabel("drive_team")).toBe("Drive Team")
        expect(rosterRoleLabel("pit_crew")).toBe("Pit Crew")
        expect(rosterRoleLabel("attending")).toBe("Attending")
    })

    it("falls back to a title-cased split on an unknown slug instead of throwing", () => {
        expect(rosterRoleLabel("some_new_role")).toBe("Some New Role")
    })

    it("handles an empty string without throwing", () => {
        expect(() => rosterRoleLabel("")).not.toThrow()
        expect(rosterRoleLabel("")).toBe("")
    })
})

describe("validatePhone", () => {
    it("blank is valid -- phone is optional", () => {
        expect(validatePhone("")).toBeNull()
        expect(validatePhone("   ")).toBeNull()
    })

    it("accepts a normally-punctuated number", () => {
        expect(validatePhone("+1 (555) 123-4567")).toBeNull()
    })

    it("accepts a bare digit string with enough digits", () => {
        expect(validatePhone("5551234567")).toBeNull()
    })

    it("rejects letters or other disallowed characters", () => {
        expect(validatePhone("555-CALL-NOW")).not.toBeNull()
    })

    it("rejects more than 30 characters", () => {
        expect(validatePhone("1".repeat(31))).not.toBeNull()
    })

    it("accepts exactly 30 characters", () => {
        expect(validatePhone("1".repeat(30))).toBeNull()
    })

    it("rejects fewer than 7 digits", () => {
        expect(validatePhone("123-456")).not.toBeNull()
    })

    it("accepts exactly 7 digits", () => {
        expect(validatePhone("1234567")).toBeNull()
    })

    it("trims surrounding whitespace before validating", () => {
        expect(validatePhone("   1234567   ")).toBeNull()
    })
})
