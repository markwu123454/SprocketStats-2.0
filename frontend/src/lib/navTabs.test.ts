import { describe, expect, it } from "vitest"

import { CORE_TABS, isMorePage, moreTabs } from "./navTabs"
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

describe("moreTabs", () => {
    it("gives a member Leaderboards and Scouting", () => {
        expect(moreTabs(MEMBER).map(t => t.label)).toEqual(["Leaderboards", "Scouting"])
    })

    it("gives alumni Leaderboards only", () => {
        expect(moreTabs(ALUMNI).map(t => t.label)).toEqual(["Leaderboards"])
    })

    it("gives a visitor no pages", () => {
        expect(moreTabs(VISITOR)).toEqual([])
    })
})

describe("isMorePage", () => {
    it("covers the pages the More sheet opens", () => {
        for (const path of ["/leaderboards", "/scouting/scout", "/control", "/control/members", "/settings"]) {
            expect(isMorePage(path)).toBe(true)
        }
    })

    it("leaves bar pages and look-alike paths to the bar", () => {
        for (const path of ["/dashboard", "/tasks", "/events/2025casj", "/controls", "/settings-old"]) {
            expect(isMorePage(path)).toBe(false)
        }
    })
})
