import type {ReactNode} from "react"
import {Link} from "react-router-dom"
import {ArrowLeft, Calendar, MapPin} from "lucide-react"
import type {ResolvedEvent} from "@/lib/events.ts"
import {STATUS_META} from "@/lib/events.ts"

const cardStyle = {background: "var(--theme-bg)", borderColor: "var(--theme-border)"}

// Shared shell for individual event pages (e.g. /events/2026cass). Renders the
// header every event page needs — back link, status, name, date/location/type
// — then hands off to `children` for event-specific content. New event pages
// should wrap their content in this instead of rebuilding the header each time.
export default function EventDetailLayout({event, children}: { event: ResolvedEvent; children?: ReactNode }) {
    const meta = STATUS_META[event.status]

    return (
        <div className="mx-auto max-w-3xl px-4 py-8 flex flex-col gap-6">
            <Link
                to="/events"
                className="inline-flex items-center gap-1.5 text-sm theme-subtext-color hover:theme-text-contrast w-fit transition-colors"
            >
                <ArrowLeft size={16}/>
                Back to events
            </Link>

            <div className="flex flex-col gap-2">
                <span className="text-[11px] font-bold tracking-wider" style={{color: meta.color}}>
                    {meta.label.toUpperCase()}
                </span>
                <h1 className="text-2xl sm:text-3xl font-bold theme-h1-color">{event.name}</h1>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm theme-subtext-color">
                    <span className="inline-flex items-center gap-1.5">
                        <Calendar size={15}/>
                        {event.dateLabel}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                        <MapPin size={15}/>
                        {event.location}
                    </span>
                    <span>{event.type}</span>
                </div>
            </div>

            <div className="rounded-xl border backdrop-blur-sm p-5 sm:p-6 flex flex-col gap-4" style={cardStyle}>
                {children}
            </div>
        </div>
    )
}
