import { useState, useEffect } from "react"
import { useParams, Outlet, NavLink, Link } from "react-router-dom"
import { Home, Calendar, Users, Package, Trophy, ArrowLeft } from "lucide-react"
import { useBootstrapped } from "@/contexts/bootstrapContext"
import { EventContext } from "@/contexts/eventContext"
import { fetchEventInfo, fetchEventUpdate, type EventInfo } from "@/lib/eventApi"

const TABS = [
    { label: "Overview",  icon: Home,     to: "",          end: true  },
    { label: "Itinerary", icon: Calendar, to: "itinerary", end: false },
    { label: "Packing",   icon: Package,  to: "packing",   end: false },
    { label: "Roster",    icon: Users,    to: "roster",    end: false },
    { label: "Comp",      icon: Trophy,   to: "comp",      end: false },
]

export default function EventShell() {
    const { eventKey } = useParams<{ eventKey: string }>()
    const [bootstrapEvent] = useBootstrapped<EventInfo | null>("current_event", null)

    const seeded = bootstrapEvent?.event_key === eventKey ? bootstrapEvent : null
    const [info,     setInfo]     = useState<EventInfo | null>(seeded)
    const [loading,  setLoading]  = useState(!seeded)
    const [notFound, setNotFound] = useState(false)

    useEffect(() => {
        if (!eventKey) return
        let cancelled = false
        fetchEventInfo(eventKey)
            .then(data => { if (!cancelled) { setInfo(data); setLoading(false) } })
            .catch((err: { status?: number }) => {
                if (!cancelled) { setNotFound(err?.status === 404); setLoading(false) }
            })
        return () => { cancelled = true }
    }, [eventKey])

    useEffect(() => {
        if (!eventKey) return
        const id = setInterval(() => {
            fetchEventUpdate(eventKey)
                .then(update => setInfo(prev => prev ? { ...prev, ...update } : prev))
                .catch(() => {})
        }, 20_000)
        return () => clearInterval(id)
    }, [eventKey])

    if (!loading && notFound) {
        return (
            <div className="flex flex-col items-center justify-center py-24 gap-4 px-4 text-center">
                <p className="text-lg font-semibold theme-text">Event not found</p>
                <p className="text-sm theme-subtext-color">No event with key <code className="font-mono">{eventKey}</code> exists yet.</p>
                <Link to="/events" className="text-sm theme-text-contrast hover:opacity-80 transition-opacity">
                    ← Back to events
                </Link>
            </div>
        )
    }

    return (
        <EventContext.Provider value={{ eventKey: eventKey ?? "", info, loading }}>
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
                            {loading ? "" : (info?.event_name ?? eventKey)}
                        </h1>
                    </div>

                    {/* Tab row: icon above text */}
                    <div className="flex -mx-0 overflow-x-auto scrollbar-none">
                        {TABS.map(({ label, icon: Icon, to, end }) => (
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
                    <Outlet />
                </div>
            </div>
        </EventContext.Provider>
    )
}
