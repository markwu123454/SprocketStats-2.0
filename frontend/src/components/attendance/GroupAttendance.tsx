import { Fragment, useState } from "react"
import { X } from "lucide-react"
import { MarkBox } from "@/components/attendance/MeetingStrip"
import {
    inDays, markLabel, memberTotals, monthDay, numericDay, pct, weekday,
    type AttendanceGroup, type GroupMeeting, type GroupSummary, type MeetingMark, type MeetingMetrics, type PersonChip,
} from "@/lib/attendance"
import { focusRing, typeBadge, typeH2 } from "@/lib/uiClasses"

// The subteam view of Control Panel > Attendance: a timeline of meetings, the
// metrics for one of them, the upcoming absences, and every person by meeting.
// Shape carries meaning, never colour alone (see MeetingStrip).

const LABEL = `${typeH2} theme-subtext-color`

/** Headcount at a meeting: who came, or for one ahead, who is still expected. */
function headcount(g: GroupMeeting): number {
    return g.past ? g.attended : g.expected - g.absent
}

/** The vertical "Today" marker between the last finished meeting and the first upcoming one. */
function TodayMarker({ compact }: { compact: boolean }) {
    return (
        <div aria-hidden="true" className={`flex-none flex flex-col items-center gap-1 relative z-[1] ${compact ? "w-9" : "w-11"}`}>
            <span className={`${typeBadge} !tracking-[0.06em] theme-text-contrast`}>Today</span>
            <span className={`w-0.5 rounded-sm bg-[var(--theme-text-contrast)] ${compact ? "h-[58px]" : "h-[70px]"}`}/>
            <span className={compact ? "h-[30px]" : "h-9"}/>
        </div>
    )
}

/** Bars per meeting, newest on the right; choosing one opens its metrics. */
export function GroupTimeline({ summary, selected, onSelect, compact = false }: {
    summary: GroupSummary, selected: number | null, onSelect: (i: number) => void, compact?: boolean,
}) {
    const n = summary.members.length
    const barMax = compact ? 40 : 48
    return (
        // rtl so it opens scrolled to the newest meetings; scroll left for earlier ones.
        <div dir="rtl" className="overflow-x-auto pb-1.5">
            <div dir="ltr" role="group" aria-label="Meetings timeline. Choose a meeting for its metrics. Scroll left for earlier meetings."
                className={`min-w-max relative flex items-end ${compact ? "gap-0.5" : "gap-1"}`}>
                <div aria-hidden="true" className={`absolute left-0 right-0 h-0.5 bg-[var(--theme-border)] ${compact ? "bottom-[43px]" : "bottom-[54px]"}`}/>
                {summary.meetings.map((g, i) => {
                    const shown = headcount(g)
                    const on = selected === i
                    const h = Math.max(compact ? 5 : 6, Math.round((g.expected ? shown / g.expected : 0) * barMax))
                    const when = `${weekday(g.meeting.start_time)} ${monthDay(g.meeting.start_time)}`
                    return (
                        <Fragment key={g.meeting.id}>
                            {i === summary.firstUpcoming && <TodayMarker compact={compact}/>}
                            <button type="button" onClick={() => onSelect(i)} aria-pressed={on}
                                aria-label={`${when}: ${shown} of ${g.expected} ${g.past ? "attended" : "expected"}`}
                                className={`flex-none flex flex-col items-center relative z-[1] rounded-[10px] border cursor-pointer ${compact ? "w-11 min-h-11 gap-1 py-1" : "w-12 gap-1.5 py-1.5"} ${on ? "border-[var(--theme-text-contrast)] bg-[var(--ag-grid-hover-bg)]" : "border-transparent hover:bg-[var(--ag-grid-hover-bg)]"} ${focusRing}`}>
                                <span className={`font-semibold ${compact ? "text-[11px]" : "text-[13px]"} ${g.past ? "theme-h1-color" : "theme-subtext-color"}`}>{shown}/{g.expected || n}</span>
                                <span className={`flex items-end ${compact ? "w-[22px] h-10" : "w-[26px] h-12"}`}>
                                    {g.past
                                        ? <span className="block w-full rounded-[5px_5px_2px_2px] bg-[var(--theme-text-contrast)]" style={{ height: h }}/>
                                        : <span className="block box-border w-full rounded-[5px_5px_2px_2px] border-2 border-dashed theme-outline" style={{ height: h }}/>}
                                </span>
                                <span className={`box-border rounded-full border-2 border-[var(--theme-bg)] ${compact ? "w-2.5 h-2.5" : "w-3 h-3"} ${g.past ? "bg-[var(--theme-text-contrast)]" : "bg-[var(--theme-outline)]"}`}/>
                                <span className={`text-center leading-tight theme-subtext-color ${compact ? "text-[11px]" : "text-xs"}`}>
                                    {weekday(g.meeting.start_time)}<br/>{compact ? numericDay(g.meeting.start_time) : monthDay(g.meeting.start_time)}
                                </span>
                            </button>
                        </Fragment>
                    )
                })}
            </div>
        </div>
    )
}

function LegendBox({ mark }: { mark: NonNullable<MeetingMark> }) {
    return <span className="inline-flex items-center"><MarkBox mark={mark} size="sm"/></span>
}

/** Tiles and name chips for one meeting. The header (title, close) belongs to the caller. */
export function MeetingMetricsBody({ metrics, onOpen, phone = false }: {
    metrics: MeetingMetrics, onOpen: (chip: PersonChip) => void, phone?: boolean,
}) {
    return (
        <>
            <dl className={`grid gap-2.5 md:gap-4 ${phone ? "grid-cols-2" : "grid-cols-[repeat(auto-fit,minmax(150px,1fr))]"}`}>
                {metrics.tiles.map(tile => (
                    <div key={tile.title} className="min-w-0 px-3.5 py-3 md:px-5 md:py-4 rounded-xl border theme-border theme-bg">
                        <dt className="text-[11px] md:text-xs font-semibold uppercase tracking-[0.08em] md:tracking-widest theme-subtext-color">{tile.title}</dt>
                        <dd className="mt-1 text-[26px] md:text-[32px] leading-tight font-bold theme-h1-color">{tile.value}</dd>
                        <dd className="text-xs md:text-sm theme-subtext-color">{tile.sub}</dd>
                    </div>
                ))}
            </dl>
            <div className={`grid gap-4 ${phone ? "grid-cols-1" : "grid-cols-[repeat(auto-fit,minmax(180px,1fr))]"}`}>
                {metrics.groups.map(grp => (
                    <div key={grp.title} className="flex flex-col gap-2.5">
                        <h4 className={`flex items-center gap-2.5 ${LABEL}`}><LegendBox mark={grp.mark}/>{grp.title} · {grp.names.length}</h4>
                        {grp.names.length === 0
                            ? <span className="text-sm theme-subtext-color">Nobody</span>
                            : <div className="flex flex-wrap gap-2">
                                {grp.names.map(chip => (
                                    <button key={chip.userId} type="button" onClick={() => onOpen(chip)}
                                        aria-label={`Open ${chip.name}${chip.meetingId ? `, ${metrics.when} absence` : ""}`}
                                        className={`min-h-9 px-3 rounded-full border theme-outline theme-bg text-[15px] font-semibold theme-h1-color hover:bg-[var(--theme-button-hover)] ${focusRing}`}>
                                        {chip.name}
                                    </button>
                                ))}
                            </div>}
                    </div>
                ))}
            </div>
        </>
    )
}

/** Desktop: the metrics panel that opens under the timeline. */
export function MeetingMetricsPanel({ metrics, onOpen, onClose }: {
    metrics: MeetingMetrics, onOpen: (chip: PersonChip) => void, onClose: () => void,
}) {
    return (
        <div role="region" aria-label={`${metrics.when} metrics`} className="flex flex-col gap-5 px-7 py-6 rounded-2xl border theme-outline bg-[var(--ag-grid-chrome-bg)]">
            <div className="flex justify-between items-start gap-4">
                <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1 min-w-0">
                    <h3 className="text-2xl font-bold theme-h1-color">{metrics.when}</h3>
                    <span className={`${typeBadge} theme-text-contrast`}>{metrics.tag}</span>
                    {metrics.purpose && <span className="text-sm font-semibold theme-text">{metrics.purpose}</span>}
                    <span className="text-sm theme-subtext-color">{metrics.note}</span>
                </div>
                <button type="button" onClick={onClose} aria-label="Close meeting metrics"
                    className={`flex-none flex items-center justify-center w-11 h-11 rounded-xl border theme-outline theme-button-bg theme-text ${focusRing}`}>
                    <X size={16} strokeWidth={2.4} aria-hidden="true"/>
                </button>
            </div>
            <MeetingMetricsBody metrics={metrics} onOpen={onOpen}/>
        </div>
    )
}

/** The next meetings with who has called out: the most prominent block on the page. */
export function UpcomingAbsences({ summary, group, now, onOpen, chipLimit, phone = false }: {
    summary: GroupSummary, group: AttendanceGroup, now: number, onOpen: (chip: PersonChip) => void, chipLimit: number, phone?: boolean,
}) {
    const [expanded, setExpanded] = useState<Set<string>>(new Set())
    const upcoming = summary.meetings.slice(summary.firstUpcoming)
    const total = upcoming.reduce((s, g) => s + g.absent, 0)
    const Heading = phone ? "h2" : "h3"
    return (
        <section aria-label="Upcoming absences"
            className={`flex flex-col gap-3 md:gap-4 border-2 border-[var(--theme-text-contrast)] ${phone ? "p-4 rounded-[18px] theme-bg" : "px-7 py-6 rounded-2xl bg-[var(--ag-grid-chrome-bg)]"}`}>
            <div className="flex flex-wrap justify-between items-baseline gap-2">
                <Heading className={`${phone ? "text-xl" : "text-2xl"} font-bold theme-h1-color`}>Upcoming absences</Heading>
                <span className="text-sm theme-subtext-color">
                    {upcoming.length === 0 ? "No meetings scheduled" : `${total} across the next ${upcoming.length === 1 ? "meeting" : `${upcoming.length} meetings`}`}
                </span>
            </div>
            {upcoming.length > 0 && (
                <ul className={`grid gap-3 md:gap-4 ${phone ? "grid-cols-1" : "grid-cols-[repeat(auto-fit,minmax(220px,1fr))]"}`}>
                    {upcoming.map(g => {
                        const out = summary.members
                            .map((m, k) => ({ m, k }))
                            .filter(({ k }) => g.marks[k] === "absent")
                            .map(({ m }) => ({ userId: m.user_id, name: m.display_name, meetingId: g.meeting.id, lead: m.level === "lead" }))
                        const coming = g.expected - out.length
                        const open = expanded.has(g.meeting.id)
                        const more = out.length > chipLimit
                        const shown = open || !more ? out : out.slice(0, chipLimit)
                        const when = `${weekday(g.meeting.start_time)} · ${monthDay(g.meeting.start_time)}`
                        const toggle = () => setExpanded(prev => {
                            const next = new Set(prev)
                            if (next.has(g.meeting.id)) next.delete(g.meeting.id); else next.add(g.meeting.id)
                            return next
                        })
                        return (
                            <li key={g.meeting.id} className={`flex flex-col gap-3 md:gap-3.5 p-3.5 md:px-5 md:py-[18px] rounded-2xl border theme-border ${phone ? "bg-[var(--ag-grid-chrome-bg)]" : "theme-bg"}`}>
                                <div className="flex justify-between items-baseline gap-2">
                                    <span className={`${typeBadge} theme-text-contrast`}>{when}</span>
                                    <span className="text-xs md:text-[13px] theme-subtext-color">{inDays(g.meeting.start_time, now)}</span>
                                </div>
                                <div className="flex flex-col gap-2">
                                    <span className={`${phone ? "text-lg" : "text-[22px]"} font-bold theme-h1-color`}>
                                        {coming} of {g.expected} coming <span className="text-sm font-normal theme-subtext-color">· {pct(coming, g.expected)}%</span>
                                    </span>
                                    <span role="img" aria-label={`${coming} of ${g.expected} coming`} className="flex gap-[3px] md:gap-1">
                                        {Array.from({ length: g.expected }, (_, s) => s < coming
                                            ? <span key={s} className="flex-1 h-2 md:h-2.5 rounded-[3px] bg-[var(--theme-text-contrast)]"/>
                                            : <span key={s} className="flex-1 box-border h-2 md:h-2.5 rounded-[3px] border-2 border-[var(--theme-subtext-color)]"/>)}
                                    </span>
                                    {group.subteam && out.some(p => p.lead) && <span className="text-sm font-semibold theme-danger">Subteam lead is out</span>}
                                </div>
                                <div className="flex flex-col gap-2">
                                    <span className={`${typeBadge} theme-subtext-color`}>Out · {out.length}</span>
                                    {out.length === 0 && <span className="text-sm theme-subtext-color">Nobody has called out</span>}
                                    {out.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5">
                                            {shown.map(p => (
                                                <button key={p.userId} type="button" onClick={() => onOpen(p)}
                                                    aria-label={`Open ${p.name}, ${when} absence and reason`}
                                                    className={`inline-flex items-baseline gap-1.5 min-h-9 px-3 py-1.5 rounded-full border theme-outline ${phone ? "theme-bg" : "bg-[var(--ag-grid-chrome-bg)]"} hover:bg-[var(--theme-button-hover)] ${focusRing}`}>
                                                    <span className="text-[15px] font-bold theme-h1-color">{p.name}</span>
                                                    {p.lead && <span className={`${typeBadge} !text-[10px] theme-text-contrast`}>Lead</span>}
                                                </button>
                                            ))}
                                            {more && (
                                                <button type="button" onClick={toggle} aria-expanded={open}
                                                    className={`inline-flex items-center min-h-9 px-3 rounded-full border border-dashed border-[var(--theme-text-contrast)] theme-text-contrast text-sm font-bold ${focusRing}`}>
                                                    {open ? "Show less" : `+${out.length - chipLimit} more`}
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </li>
                        )
                    })}
                </ul>
            )}
        </section>
    )
}

/** Every person by every meeting shown: a fixed name column, meetings that scroll (newest first in view). */
export function PersonGrid({ summary, onOpen, phone = false }: {
    summary: GroupSummary, onOpen: (userId: string) => void, phone?: boolean,
}) {
    const rowH = phone ? "h-12" : "h-[49px]"
    const headH = phone ? "h-11" : "h-14"
    const cellW = phone ? "w-[34px]" : "w-11"
    const divider = (h: string) => <span aria-hidden="true" className={`flex-none w-px ${h} ${phone ? "mx-[5px]" : "mx-2"} bg-[var(--theme-outline)]`}/>
    return (
        <div className="flex flex-col gap-2.5 md:gap-3.5">
            <h3 className={LABEL}>All meetings · by person{phone ? "" : " · scroll left for earlier"}</h3>
            <div className={`flex border theme-border overflow-hidden ${phone ? "rounded-[14px] theme-bg" : "rounded-2xl bg-[var(--ag-grid-chrome-bg)]"}`}>
                <div className={`flex-none flex flex-col border-r theme-border ${phone ? "w-[116px]" : "w-36"}`}>
                    <div className={`${headH} box-border flex items-center px-3 md:px-4 bg-[var(--ag-grid-header-bg)] border-b border-[var(--ag-grid-row-border)] ${typeBadge} theme-subtext-color`}>Person</div>
                    {summary.members.map((m, k) => {
                        const t = memberTotals(summary, k)
                        return (
                            <div key={m.user_id} className={`${rowH} box-border flex items-center border-b border-[var(--ag-grid-row-border)]`}>
                                <button type="button" onClick={() => onOpen(m.user_id)}
                                    className={`w-full h-full flex flex-col justify-center items-start px-3 md:px-4 text-left hover:bg-[var(--ag-grid-hover-bg)] ${focusRing}`}>
                                    <span className="text-[15px] md:text-base leading-tight font-semibold theme-h1-color truncate max-w-full">{m.display_name}</span>
                                    {phone && <span className="text-[11px] leading-tight whitespace-nowrap truncate max-w-full theme-subtext-color">{t.missed} missed · {t.absent} ahead</span>}
                                </button>
                            </div>
                        )
                    })}
                </div>
                <div dir="rtl" className="flex-1 min-w-0 overflow-x-auto">
                    <div dir="ltr" className="min-w-max flex flex-col">
                        <div className={`${headH} box-border flex items-center px-1.5 md:px-3 bg-[var(--ag-grid-header-bg)] border-b border-[var(--ag-grid-row-border)] text-[10px] md:text-xs theme-subtext-color`}>
                            {summary.meetings.map((g, i) => (
                                <Fragment key={g.meeting.id}>
                                    {i > 0 && i === summary.firstUpcoming && divider(phone ? "h-6" : "h-7")}
                                    <span className={`${cellW} flex-none text-center leading-tight`}>{weekday(g.meeting.start_time)}<br/>{numericDay(g.meeting.start_time)}</span>
                                </Fragment>
                            ))}
                        </div>
                        {summary.members.map((m, k) => (
                            <div key={m.user_id} className={`${rowH} box-border flex items-center px-1.5 md:px-3 border-b border-[var(--ag-grid-row-border)]`}>
                                {summary.meetings.map((g, i) => {
                                    const label = `${m.display_name}, ${weekday(g.meeting.start_time)} ${monthDay(g.meeting.start_time)}: ${markLabel(g.marks[k])}`
                                    return (
                                        <Fragment key={g.meeting.id}>
                                            {i > 0 && i === summary.firstUpcoming && divider(phone ? "h-5" : "h-6")}
                                            <span role="img" aria-label={label} title={label} className={`${cellW} h-7 flex-none flex items-center justify-center`}>
                                                <MarkBox mark={g.marks[k]} size={phone ? "sm" : "md"}/>
                                            </span>
                                        </Fragment>
                                    )
                                })}
                            </div>
                        ))}
                    </div>
                </div>
                {!phone && (
                    <div className="flex-none w-32 flex flex-col border-l theme-border">
                        <div className={`${headH} box-border flex items-center justify-end px-4 bg-[var(--ag-grid-header-bg)] border-b border-[var(--ag-grid-row-border)] ${typeBadge} theme-subtext-color`}>Missed · ahead</div>
                        {summary.members.map((m, k) => {
                            const t = memberTotals(summary, k)
                            return <div key={m.user_id} className={`${rowH} box-border flex items-center justify-end px-4 border-b border-[var(--ag-grid-row-border)] text-[15px] theme-subtext-color`}>{t.missed} · {t.absent}</div>
                        })}
                    </div>
                )}
            </div>
            <GridLegend phone={phone}/>
        </div>
    )
}

function GridLegend({ phone }: { phone: boolean }) {
    const marks: NonNullable<MeetingMark>[] = ["attended", "missed", "absent", "scheduled"]
    return (
        <div className={`flex flex-wrap gap-x-4 gap-y-1.5 md:gap-x-6 ${phone ? "text-xs" : "text-sm"} theme-subtext-color`}>
            {marks.map(mark => (
                <span key={mark} className="inline-flex items-center gap-2"><LegendBox mark={mark}/>{markLabel(mark)}</span>
            ))}
        </div>
    )
}
