import {Users} from "lucide-react"
import EventDetailLayout from "@/components/events/EventDetailLayout.tsx"
import EventComingSoonPage from "@/pages/EventComingSoonPage.tsx"
import {resolveEventByUrl} from "@/lib/events.ts"

// Detail page for the 2026 SoCal Showdown (/events/2026cass). Not much is
// locked in yet — this establishes the layout other event pages should
// follow; swap this placeholder body out as real details show up.
export default function Socal2026Page() {
    const event = resolveEventByUrl("/events/2026cass")
    if (!event) return <EventComingSoonPage/>

    return (
        <EventDetailLayout event={event}>
            <p className="text-sm sm:text-base theme-text">
                Team 3473 Sprocket is heading to the 2026 SoCal Showdown! More details — schedule,
                logistics, and how to follow along — will be posted here as they're finalized.
            </p>

            <div className="flex items-center gap-3 rounded-lg border p-3 theme-border">
                <Users size={18} className="theme-text-contrast opacity-80 shrink-0"/>
                <p className="text-sm theme-subtext-color">
                    Check back closer to the event for match schedules, results, and team updates.
                </p>
            </div>
        </EventDetailLayout>
    )
}
