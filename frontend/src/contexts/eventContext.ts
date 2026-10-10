import { createContext, useContext } from "react"
import type { EventInfo } from "@/lib/eventApi"

export interface EventContextValue {
    eventKey: string
    info: EventInfo | null
    loading: boolean
    updateInfo: (patch: Partial<EventInfo>) => void
}

export const EventContext = createContext<EventContextValue | null>(null)

export function useEventContext(): EventContextValue {
    const ctx = useContext(EventContext)
    if (!ctx) throw new Error("useEventContext must be used inside EventShell")
    return ctx
}
