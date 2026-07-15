import { Link } from "react-router-dom"
import { CalendarClock } from "lucide-react"
import {useAppReady} from "@/contexts/appReadyContext";
import {useEffect} from "react";

// Matches "/events/*" in App.tsx — catches event links from EventsPage (e.g.
// /events/fll) that don't have a dedicated page built yet, so visitors get a
// relevant message instead of a generic 404.
export default function EventComingSoonPage() {
    const markReady = useAppReady()

    useEffect(() => { markReady() }, [markReady])

    return (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-4 py-16 text-center">
            <div
                className="flex items-center justify-center w-16 h-16 rounded-full border theme-border theme-bg"
            >
                <CalendarClock size={28} className="theme-text-contrast opacity-70" />
            </div>

            <h1 className="text-base font-medium theme-text">This event doesn't have a page yet</h1>
            <p className="text-sm theme-subtext-color max-w-xs">
                Check back closer to the event, details will show up here once they're available.
            </p>

            <Link
                to="/events"
                className="mt-2 inline-flex items-center theme-text-contrast theme-bg gap-1 font-bold rounded-lg px-4 py-2.5 text-sm transition-opacity hover:opacity-90"
            >
                Back to events
            </Link>
        </div>
    )
}
