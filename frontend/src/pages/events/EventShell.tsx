import { useState, useEffect, useContext, useCallback } from "react"
import { useParams, Outlet, NavLink, Link, Navigate, useLocation } from "react-router-dom"
import { Home, Calendar, Users, Package, Trophy, ArrowLeft, CalendarClock, ListTodo } from "lucide-react"
import { useBootstrapped, BootstrapContext } from "@/contexts/bootstrapContext"
import { EventContext } from "@/contexts/eventContext"
import { fetchEventInfo, fetchEventUpdate, fetchEvents, type EventInfo } from "@/lib/eventApi"
import { findByHubKey, hiddenTabsOf, isTabHidden, resolveEvents, type EventEntry, type HubTab } from "@/lib/events"

// `to` doubles as the HubTab id for every tab but Overview, which can't be hidden.
const TABS: { label: string; icon: typeof Home; to: "" | HubTab; end: boolean }[] = [
    { label: "Overview",  icon: Home,     to: "",          end: true  },
    { label: "Itinerary", icon: Calendar, to: "itinerary", end: false },
    { label: "Packing",   icon: Package,  to: "packing",   end: false },
    { label: "Roster",    icon: Users,    to: "roster",    end: false },
    { label: "Tasks",     icon: ListTodo, to: "tasks",     end: false },
    { label: "Comp",      icon: Trophy,   to: "comp",      end: false },
]

export default function EventShell() {
    const { eventKey } = useParams<{ eventKey: string }>()
    const location = useLocation()
    const [bootstrapEvent] = useBootstrapped<EventInfo | null>("current_event", null)
    const [eventKeys] = useBootstrapped<string[]>("event_keys", [])
    const [scheduleEvents, setScheduleEvents] = useBootstrapped<EventEntry[]>("events", [])

    // The bootstrap copy is a snapshot from app load -- refetch so tab
    // visibility edited on the Events page since then applies here.
    useEffect(() => {
        let cancelled = false
        fetchEvents()
            .then(data => { if (!cancelled) setScheduleEvents(data) })
            .catch(() => {})
        return () => { cancelled = true }
    }, [setScheduleEvents])

    const scheduleEntry = findByHubKey(scheduleEvents, eventKey)
    const visibleTabs = TABS.filter(t => t.to === "" || !isTabHidden(scheduleEntry, t.to))
    // A hidden tab reached by a direct link or bookmark falls back to Overview.
    const currentTab = location.pathname.split("/")[3] as HubTab | undefined
    const onHiddenTab = !!currentTab && isTabHidden(scheduleEntry, currentTab)

    // An event with no schedule entry is never treated as archived -- better
    // to keep polling than to hide live data for an event we can't date.
    const archived = resolveEvents(scheduleEntry ? [scheduleEntry] : []).some(e => e.status === "done")

    // /bootstrap already ran on app load and carries every valid event_key, so
    // once it's resolved we can tell a real event from a 404 synchronously —
    // no per-event fetch, no loading flash, before ever hitting the network.
    const bootstrapCache = useContext(BootstrapContext)
    const keysReady    = "event_keys" in bootstrapCache
    const knownInvalid = keysReady && !!eventKey && !eventKeys.includes(eventKey)

    const seeded = bootstrapEvent?.event_key === eventKey ? bootstrapEvent : null
    const [info,      setInfo]      = useState<EventInfo | null>(seeded)
    const [loading,   setLoading]   = useState(!seeded)
    const [fetchedNotFound, setFetchedNotFound] = useState(false)

    const notFound = knownInvalid || fetchedNotFound

    useEffect(() => {
        if (!eventKey || knownInvalid) return
        let cancelled = false
        fetchEventInfo(eventKey)
            .then(data => { if (!cancelled) { setInfo(data); setLoading(false) } })
            .catch((err: { status?: number }) => {
                if (!cancelled) { setFetchedNotFound(err?.status === 404); setLoading(false) }
            })
        return () => { cancelled = true }
    }, [eventKey, knownInvalid])

    // Archived events' results are final -- the initial /info fetch is enough.
    useEffect(() => {
        if (!eventKey || notFound || archived) return
        const id = setInterval(() => {
            fetchEventUpdate(eventKey)
                .then(update => setInfo(prev => prev ? { ...prev, ...update } : prev))
                .catch(() => {})
        }, 20_000)
        return () => clearInterval(id)
    }, [eventKey, notFound, archived])

    const isLoading = loading && !knownInvalid

    const updateInfo = useCallback((patch: Partial<EventInfo>) => {
        setInfo(prev => prev ? { ...prev, ...patch } : prev)
    }, [])

    return (
        <EventContext.Provider value={{ eventKey: eventKey ?? "", info, loading: isLoading, archived, hiddenTabs: hiddenTabsOf(scheduleEntry), updateInfo }}>
            <div className="h-full flex flex-col">
                <div
                    className="sticky top-0 z-10 border-b theme-border"
                    style={{ background: "var(--theme-bg)" }}
                >
                    {/* Title row: back link left, event name centered */}
                    <div className="relative flex items-center px-2 h-11">
                        <Link
                            to="/events"
                            className="inline-flex items-center gap-1 text-xs font-medium shrink-0 transition-opacity hover:opacity-70"
                            style={{ color: "var(--theme-subtext-color)" }}
                        >
                            <ArrowLeft size={13} />
                            Events
                        </Link>
                        <h1
                            className="absolute left-1/2 -translate-x-1/2 text-base font-bold truncate max-w-[55%]"
                            style={{ color: "var(--theme-h1-color)" }}
                        >
                            {isLoading ? "" : notFound ? "Event not found" : (info?.event_name ?? eventKey)}
                        </h1>
                    </div>

                    {/* Tab row: icon above text — stays mounted (and navigable) even on a 404,
                        so the header height never shifts; the body below decides what to show. */}
                    <div className="flex -mx-0 overflow-x-auto scrollbar-none">
                        {visibleTabs.map(({ label, icon: Icon, to, end }) => (
                            <NavLink
                                key={label}
                                to={to}
                                end={end}
                                className={({ isActive }) => [
                                    "flex-1 flex flex-col items-center gap-0.5 px-1 pt-2 pb-2.5 text-[10px] font-medium whitespace-nowrap border-b-2 shrink-0 transition-colors",
                                    isActive ? "border-current" : "border-transparent",
                                ].join(" ")}
                                style={({ isActive }) => ({
                                    color: isActive ? "var(--theme-text-contrast)" : "var(--theme-subtext-color)",
                                })}
                            >
                                <Icon size={16} />
                                {label}
                            </NavLink>
                        ))}
                    </div>
                </div>

                <div className="flex-1 min-h-0 overflow-auto">
                    {notFound ? (
                        <div className="h-full flex flex-col items-center justify-center gap-4 px-4 py-16 text-center">
                            <div className="flex items-center justify-center w-16 h-16 rounded-full border theme-border theme-bg">
                                <CalendarClock size={28} className="theme-text-contrast opacity-70" />
                            </div>
                            <p className="text-base font-medium theme-text">404 — event not found</p>
                            <p className="text-sm theme-subtext-color max-w-xs">
                                No event with key <code className="font-mono">{eventKey}</code> exists.
                            </p>
                            <Link
                                to="/events"
                                className="mt-2 inline-flex items-center theme-text-contrast theme-bg gap-1 font-bold rounded-lg px-4 py-2.5 text-sm transition-opacity hover:opacity-90"
                            >
                                Back to events
                            </Link>
                        </div>
                    ) : onHiddenTab ? (
                        <Navigate to={`/events/${eventKey}`} replace />
                    ) : (
                        <Outlet />
                    )}
                </div>
            </div>
        </EventContext.Provider>
    )
}
