import { createContext, useContext } from "react"
import type { EventInfo } from "@/lib/eventApi"
import type { HubTab } from "@/lib/events"

export interface EventContextValue {
    eventKey: string
    info: EventInfo | null
    loading: boolean
    /** The event is over -- pages show final results instead of live/upcoming state. */
    archived: boolean
    /** Hub tabs this event hides -- pages shouldn't link into them. */
    hiddenTabs: HubTab[]
    updateInfo: (patch: Partial<EventInfo>) => void
}

export const EventContext = createContext<EventContextValue | null>(null)

export function useEventContext(): EventContextValue {
    const ctx = useContext(EventContext)
    if (!ctx) throw new Error("useEventContext must be used inside EventShell")
    return ctx
}
