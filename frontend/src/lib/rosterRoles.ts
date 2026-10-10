// Single source of truth for roster role slugs/labels/order -- shared by the
// dashboard's check-in form and RosterPage's role-change editor, so neither
// page can drift from the other (or from the backend's own role list).

/** All seven roles a roster entry can hold, in the order the roster grid has
 *  always sorted them (see `ROLE_ORDER` in RosterPage.tsx before this file
 *  existed). */
export type RosterRole = "mentor" | "chaperone" | "captain" | "lead" | "drive_team" | "pit_crew" | "attending"

/** The subset of roles assignable through self check-in or the roster's
 *  role-change editor (older chaperone/captain/lead entries are read-only
 *  leftovers -- display them, but neither flow can assign them). */
export type AssignableRole = "attending" | "drive_team" | "pit_crew" | "mentor"

interface RoleOption<T extends string> {
    value: T
    label: string
}

export const ROSTER_ROLES: RoleOption<RosterRole>[] = [
    { value: "mentor", label: "Mentor" },
    { value: "chaperone", label: "Chaperone" },
    { value: "captain", label: "Captain" },
    { value: "lead", label: "Lead" },
    { value: "drive_team", label: "Drive Team" },
    { value: "pit_crew", label: "Pit Crew" },
    { value: "attending", label: "Attending" },
]

// "Attending" first so it's the check-in form's default selection.
export const ASSIGNABLE_ROLES: RoleOption<AssignableRole>[] = [
    { value: "attending", label: "Attending" },
    { value: "drive_team", label: "Drive Team" },
    { value: "pit_crew", label: "Pit Crew" },
    { value: "mentor", label: "Mentor" },
]

/** Display label for a role slug. Falls back to a title-cased split on `_`
 *  for anything not in `ROSTER_ROLES` (matches the roster grid's old
 *  behavior of formatting whatever string it was given, rather than
 *  crashing or showing a raw slug for an unexpected value). */
export function rosterRoleLabel(slug: string): string {
    const known = ROSTER_ROLES.find(r => r.value === slug)
    if (known) return known.label
    return slug.split("_").filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ")
}

const PHONE_CHARS_RE = /^[0-9 +\-().]*$/

/** Mirrors the backend's check-in phone rule: optional (blank is valid);
 *  when given, at most 30 characters, only digits/spaces/`+ - ( ) .`, and at
 *  least 7 digits. Returns an error message, or `null` when valid. */
export function validatePhone(input: string): string | null {
    const value = input.trim()
    if (value === "") return null
    if (value.length > 30) return "Phone number must be 30 characters or fewer."
    if (!PHONE_CHARS_RE.test(value)) return "Phone number can only contain digits, spaces, and + - ( ) ."
    const digitCount = (value.match(/\d/g) ?? []).length
    if (digitCount < 7) return "Enter a phone number with at least 7 digits."
    return null
}
