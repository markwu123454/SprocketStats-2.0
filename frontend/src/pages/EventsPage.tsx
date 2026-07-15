import {ChevronRight} from "lucide-react"
import {Link} from "react-router-dom";
import {type EventStatus, resolveEvents} from "@/lib/events.ts"

const STATUS_META: Record<EventStatus, { label: string; dotFilled: boolean; color: string }> = {
    done: {label: "Completed", dotFilled: true, color: "var(--theme-subtext-color)"},
    current: {label: "Happening now", dotFilled: true, color: "var(--theme-text-contrast)"},
    upcoming: {label: "Upcoming", dotFilled: false, color: "var(--theme-subtext-color)"},
}

const cardStyle = {background: "var(--theme-bg)", borderColor: "var(--theme-border)"}

export default function EventsPage() {
    const events = resolveEvents()

return (
    <div className="mx-auto px-4 py-8 flex flex-col gap-1">
        <h1 className="text-2xl font-bold theme-h1-color">Events</h1>
        <p className="text-sm theme-subtext-color mb-6">Season schedule</p>

        <div className="flex flex-col">
            {events.map((event, i) => {
                const meta = STATUS_META[event.status]
                const isLast = i === events.length - 1
                const cardClassName = `flex items-center gap-3 sm:gap-5 rounded-xl border backdrop-blur-sm p-3 sm:p-4 pl-4 sm:pl-5 transition-colors ${event.url ? "hover:border-(--theme-text-contrast)" : ""}`

                const cardContent = (
                    <>
                        <div className="flex flex-col min-w-0 sm:min-w-[150px]">
                            <span className="text-[11px] font-bold tracking-wider truncate"
                                  style={{color: meta.color}}>
                                {meta.label.toUpperCase()}
                            </span>
                            <span
                                className="text-xs sm:text-sm theme-subtext-color mt-0.5">{event.dateLabel}</span>
                        </div>

                        <div className="flex-1 min-w-0">
                            <div
                                className="text-sm sm:text-base font-bold theme-text truncate">{event.name}</div>
                            <div
                                className="text-xs sm:text-sm theme-subtext-color truncate">{event.type} · {event.location}</div>
                        </div>

                        {/* Big "View" action — mobile collapses to a 44px circular tap target */}
                            {event.url && (
                                <div
                                    className="shrink-0 flex items-center justify-center gap-1 font-bold rounded-full sm:rounded-lg w-11 h-11 sm:w-auto sm:h-auto sm:px-4 sm:py-2.5"
                                    style={{background: "var(--theme-text-contrast)", color: "var(--theme-bg)"}}
                                >
                                    <span className="hidden sm:inline text-sm">View</span>
                                    <ChevronRight size={18}/>
                                </div>
                            )}
                        </>
                    )

                    return (
                        <div key={`${event.name}-${event.start}`} className="flex gap-3 sm:gap-5">
                            {/* Timeline rail */}
                            <div className="flex flex-col items-center w-4 sm:w-5 shrink-0">
                                <div
                                    className="w-3 h-3 sm:w-3.5 sm:h-3.5 rounded-full shrink-0 mt-5"
                                    style={{
                                        background: meta.dotFilled ? meta.color : "transparent",
                                        border: `2px solid ${meta.color}`,
                                    }}
                                />
                                {!isLast && <div className="w-0.5 flex-1" style={{background: "var(--theme-border)"}}/>}
                            </div>

                            {/* Event card */}
                            <div className="flex-1 min-w-0 pb-6">
                                {event.url ? (
                                    <Link to={event.url} className={cardClassName} style={cardStyle}>
                                        {cardContent}
                                    </Link>
                                ) : (
                                    <div className={cardClassName} style={cardStyle}>
                                        {cardContent}
                                    </div>
                                )}
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
