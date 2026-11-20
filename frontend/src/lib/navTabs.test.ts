import { describe, expect, it } from "vitest"

import { CORE_TABS, otherPages } from "./navTabs"
import type { PermPolicy } from "./permissions"

// Policies shaped like the backend's ROLE_DEFINITIONS entries (only the paths
// the menus read). The server refuses the data either way; these pin down
// that the menus don't offer pages a role can't open.
const MEMBER: PermPolicy = {
    tasks: { view: true, participate: true },
    events: { details: true },
    meetings: { details: true },
    leaderboards: { view: true },
    scouting: { view: true },
}
const ALUMNI: PermPolicy = {
    tasks: { view: true, participate: false },
    events: { details: true },
    meetings: { details: true },
    leaderboards: { view: true },
}
const VISITOR: PermPolicy = { tasks: { view: false } }

const tabsFor = (perms: PermPolicy) => CORE_TABS.filter(t => !t.visible || t.visible(perms)).map(t => t.label)

describe("CORE_TABS", () => {
    it("shows a member every tab", () => {
        expect(tabsFor(MEMBER)).toEqual(["Dashboard", "Meetings", "Events", "Tasks", "Leaderboards", "Scouting"])
    })

    it("hides Scouting from alumni", () => {
        expect(tabsFor(ALUMNI)).toEqual(["Dashboard", "Meetings", "Events", "Tasks", "Leaderboards"])
    })

    it("gives visitors the dashboard, meetings and events only", () => {
        expect(tabsFor(VISITOR)).toEqual(["Dashboard", "Meetings", "Events"])
    })
})

describe("otherPages", () => {
    it("leaves a visitor just Settings", () => {
        expect(otherPages(VISITOR).map(t => t.label)).toEqual(["Settings"])
    })
})
