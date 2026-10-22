import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from "react"
import {
    Ban, Check, ChevronDown, Clock, Copy, Crown, EyeOff, LayoutGrid, List, MoreHorizontal,
    Pencil, Plus, RotateCcw, Rows3, Search, ShieldCheck, Tags, UserCheck, Users, X,
} from "lucide-react"
import Avatar from "@/components/Avatar"
import Dropdown, { type DropdownOption } from "@/components/ui/Dropdown"

/*
 * Members Directory — a scannable replacement for the 9-column roster grid.
 *
 * Self-contained: runs on the MOCK_MEMBERS seed below so every tab, filter and
 * view mode works without a backend. Edits (drawer fields, ban/unban, tags) are
 * staged as per-member drafts and committed together from the floating
 * "Unsaved changes" bar, mirroring the staged Save/Reset model of MembersPage.
 * Styling follows frontend/DESIGN_SYSTEM.md; the subteam palette and the new
 * components used here are specced in §2.1 and §3.11–§3.14 of that doc.
 */

// ── Data model ──────────────────────────────────────────────────────────

const SUBTEAMS = ["Programming", "CAD", "Scouting", "Electrical", "Manufacturing", "Outreach", "Publicity", "Mentor"] as const
type Subteam = (typeof SUBTEAMS)[number]

const GRADES = ["Freshman", "Sophomore", "Junior", "Senior"] as const
type Grade = (typeof GRADES)[number]

const STATUSES = ["Approved", "Pending", "Banned"] as const
type Status = (typeof STATUSES)[number]

interface Member {
    id: string
    name: string
    displayName: string
    /** "Hidden" when the server masks it (e.g. a Mentor's address for Lead viewers). */
    email: string
    subteam: Subteam
    isLead: boolean
    grade: Grade | null
    year: number | null
    status: Status
    tags: string[]
}

type TabKey = "active" | "pending" | "mentors" | "banned"
type ViewMode = "grid" | "grouped" | "list"

const TAG_RE = /^[a-z0-9_]{1,64}$/
const HIDDEN_EMAIL = "Hidden"

// ── Mock roster ─────────────────────────────────────────────────────────

let seq = 0
function m(
    name: string, displayName: string, subteam: Subteam, grade: Grade | null, year: number | null,
    opts: { lead?: boolean; status?: Status; tags?: string[]; email?: string } = {},
): Member {
    seq += 1
    const studentId = 317500 + seq * 37
    return {
        id: `m${seq}`,
        name,
        displayName,
        email: opts.email ?? `${studentId}@stu.wvusd.org`,
        subteam,
        isLead: opts.lead ?? false,
        grade,
        year,
        status: opts.status ?? "Approved",
        tags: opts.tags ?? [],
    }
}

const MOCK_MEMBERS: Member[] = [
    // Programming
    m("Aaron Lee", "Aaron", "Programming", "Senior", 4, { lead: true, tags: ["drive_team", "captain"] }),
    m("Priya Natarajan", "Priya", "Programming", "Junior", 3, { tags: ["vision", "drive_team"] }),
    m("Marcus Chen", "Marcus", "Programming", "Sophomore", 2, { tags: ["autonomous"] }),
    m("Sofia Ramirez", "Sofi", "Programming", "Freshman", 1),
    m("Ethan Park", "Ethan", "Programming", "Freshman", 1, { status: "Pending" }),
    // CAD
    m("Hannah Kim", "Hannah", "CAD", "Senior", 3, { lead: true, tags: ["onshape", "pit_crew"] }),
    m("Diego Alvarez", "Diego", "CAD", "Junior", 2, { tags: ["onshape"] }),
    m("Grace Liu", "Grace", "CAD", "Sophomore", 2),
    m("Owen Patel", "Owen", "CAD", "Freshman", 1, { status: "Pending" }),
    // Scouting
    m("Maya Thompson", "Maya", "Scouting", "Junior", 3, { lead: true, tags: ["strategy", "drive_team"] }),
    m("Leo Nguyen", "Leo", "Scouting", "Sophomore", 1, { tags: ["data_entry"] }),
    m("Ava Johnson", "Ava", "Scouting", "Freshman", 1, { tags: ["data_entry"] }),
    m("Noah Williams", "Noah", "Scouting", "Senior", 2, { status: "Banned", tags: ["data_entry"] }),
    // Electrical
    m("Isaac Moreno", "Ike", "Electrical", "Senior", 4, { lead: true, tags: ["pit_crew", "safety_captain"] }),
    m("Chloe Wang", "Chloe", "Electrical", "Junior", 2, { tags: ["wiring"] }),
    m("Ryan Brooks", "Ryan", "Electrical", "Sophomore", 1, { status: "Pending" }),
    // Manufacturing
    m("Jasmine Ortiz", "Jas", "Manufacturing", "Senior", 3, { lead: true, tags: ["cnc", "pit_crew"] }),
    m("Tyler Nakamura", "Tyler", "Manufacturing", "Junior", 3, { tags: ["cnc", "lathe"] }),
    m("Emma Davis", "Emma", "Manufacturing", "Sophomore", 2, { tags: ["lathe"] }),
    m("Lucas Martin", "Lucas", "Manufacturing", "Freshman", 1),
    m("Kevin Tran", "KT", "Manufacturing", "Junior", 2, { status: "Banned" }),
    // Outreach
    m("Olivia Garcia", "Liv", "Outreach", "Junior", 3, { lead: true, tags: ["first_lego_league", "sponsorships"] }),
    m("Daniel Kowalski", "Dan", "Outreach", "Sophomore", 1, { tags: ["sponsorships"] }),
    m("Zoe Adams", "Zoe", "Outreach", "Freshman", 1, { status: "Pending" }),
    // Publicity
    m("Mia Hernandez", "Mia", "Publicity", "Senior", 4, { lead: true, tags: ["photography", "chairmans"] }),
    m("Jacob Singh", "Jake", "Publicity", "Junior", 2, { tags: ["video"] }),
    m("Lily Chang", "Lily", "Publicity", "Freshman", 1, { tags: ["social_media"] }),
    // Mentors
    m("Dr. Rebecca Stone", "Dr. Stone", "Mentor", null, null, { tags: ["head_coach"], email: "rstone@wvusd.org" }),
    m("Michael Ross", "Mr. Ross", "Mentor", null, null, { tags: ["engineering", "cnc"], email: HIDDEN_EMAIL }),
    m("Angela Wu", "Ms. Wu", "Mentor", null, null, { tags: ["programming"], email: HIDDEN_EMAIL }),
    m("Brian Foster", "Brian", "Mentor", null, null, { status: "Pending", email: "bfoster@gmail.com" }),
    m("Carl Jensen", "Carl", "Mentor", null, null, { status: "Banned", email: HIDDEN_EMAIL }),
]

// ── Tokens local to this screen ─────────────────────────────────────────

/** Subteam category hues (DESIGN_SYSTEM.md §2.1 "Category role"). Season-
 *  invariant like danger; always consumed through `categoryStyle`, never raw. */
const SUBTEAM_HUE: Record<Subteam, string | null> = {
    Programming:   "#3b82f6",
    CAD:           "#f97316",
    Scouting:      "#a855f7",
    Electrical:    "#10b981",
    Manufacturing: "#06b6d4",
    Outreach:      "#ec4899",
    Publicity:     "#f59e0b",
    // Mentors aren't a department — they take the season accent instead.
    Mentor:        null,
}

function categoryStyle(subteam: Subteam): CSSProperties {
    const hue = SUBTEAM_HUE[subteam] ?? "var(--theme-text-contrast)"
    return {
        // Mixing the label toward theme-text keeps it legible on both the
        // navy (2025) and parchment (2026) surfaces without per-season overrides.
        color: `color-mix(in oklch, ${hue} 70%, var(--theme-text))`,
        background: `color-mix(in oklch, ${hue} 14%, transparent)`,
        borderColor: `color-mix(in oklch, ${hue} 38%, transparent)`,
    }
}

const DANGER: CSSProperties = {
    color: "#dc2626",
    borderColor: "color-mix(in oklch, #dc2626 40%, transparent)",
    background: "color-mix(in oklch, #dc2626 10%, transparent)",
}

const accentTint = (pct: number) => `color-mix(in oklch, var(--theme-text-contrast) ${pct}%, transparent)`

const EASE_SHEET = "cubic-bezier(0.32, 0.72, 0, 1)"

const inputCls = "w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-2 transition theme-bg theme-border theme-text"
const triggerCls = "rounded-lg border px-3 py-2 text-sm theme-bg theme-border theme-text focus:ring-2 outline-none"
const iconBtnCls = "flex items-center justify-center w-9 h-9 rounded-lg theme-text opacity-60 hover:opacity-100 transition-opacity focus:outline-none focus-visible:ring-2"

// ── Helpers ─────────────────────────────────────────────────────────────

function tabOf(mem: Member): TabKey {
    if (mem.status === "Banned") return "banned"
    if (mem.status === "Pending") return "pending"
    return mem.subteam === "Mentor" ? "mentors" : "active"
}

function matchesQuery(mem: Member, q: string): boolean {
    if (!q) return true
    const hay = [mem.name, mem.displayName, mem.email === HIDDEN_EMAIL ? "" : mem.email, ...mem.tags]
    return hay.some(s => s.toLowerCase().includes(q))
}

/** Leads first, then by name — used everywhere a roster is listed. */
function byLeadThenName(a: Member, b: Member): number {
    if (a.isLead !== b.isLead) return a.isLead ? -1 : 1
    return a.name.localeCompare(b.name)
}

function sameValue(a: unknown, b: unknown): boolean {
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => v === b[i])
    return a === b
}

/** Dismiss-on-outside-click, the ref + document listener pattern from §3.10. */
function useOutsideClick(ref: RefObject<HTMLElement | null>, active: boolean, onOutside: () => void) {
    useEffect(() => {
        if (!active) return
        function handler(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) onOutside()
        }
        document.addEventListener("mousedown", handler)
        return () => document.removeEventListener("mousedown", handler)
    }, [ref, active, onOutside])
}

// ── Small display pieces ────────────────────────────────────────────────

const pillCls = "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap"

function SubteamBadge({ subteam, isLead }: { subteam: Subteam; isLead: boolean }) {
    return (
        <span className={pillCls} style={categoryStyle(subteam)}>
            {isLead && <Crown size={12} strokeWidth={2.4} aria-hidden />}
            {subteam}
            {isLead && <span className="font-mono uppercase tracking-[0.14em] text-[10px]">· Lead</span>}
        </span>
    )
}

function ExperiencePill({ member }: { member: Member }) {
    if (member.subteam === "Mentor" || (!member.grade && !member.year)) return null
    const parts = [member.grade, member.year ? `Year ${member.year}` : null].filter(Boolean)
    return <span className={`${pillCls} theme-border theme-text`} style={{ fontWeight: 500 }}>{parts.join(" • ")}</span>
}

function StatusFlag({ status }: { status: Status }) {
    if (status === "Approved") return null
    if (status === "Banned") {
        return <span className={pillCls} style={DANGER}><Ban size={11} aria-hidden />Banned</span>
    }
    return (
        <span className={`${pillCls} theme-text-contrast`} style={{ borderColor: accentTint(40), background: accentTint(10) }}>
            <Clock size={11} aria-hidden />Pending
        </span>
    )
}

function TagPill({ tag, onRemove }: { tag: string; onRemove?: () => void }) {
    return (
        <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-mono theme-text-contrast"
            style={{ background: accentTint(12) }}
        >
            #{tag}
            {onRemove && (
                <button type="button" onClick={onRemove} aria-label={`Remove tag ${tag}`} className="opacity-60 hover:opacity-100 transition-opacity">
                    <X size={11} />
                </button>
            )}
        </span>
    )
}

function TagList({ tags, max = 4 }: { tags: string[]; max?: number }) {
    if (!tags.length) return null
    return (
        <div className="flex flex-wrap gap-1">
            {tags.slice(0, max).map(t => <TagPill key={t} tag={t} />)}
            {tags.length > max && <span className="text-[11px] theme-subtext-color self-center">+{tags.length - max}</span>}
        </div>
    )
}

function EmailButton({ email }: { email: string }) {
    const [copied, setCopied] = useState(false)
    if (email === HIDDEN_EMAIL) {
        return (
            <span className="inline-flex items-center gap-1 text-[12px] theme-subtext-color opacity-70">
                <EyeOff size={12} aria-hidden />Email hidden
            </span>
        )
    }
    return (
        <button
            type="button"
            title="Copy email"
            onClick={e => {
                e.stopPropagation()
                void navigator.clipboard?.writeText(email)
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1400)
            }}
            className="group inline-flex items-center gap-1 max-w-full text-[12px] theme-subtext-color hover:opacity-100 opacity-80 transition-opacity rounded focus:outline-none focus-visible:ring-2"
        >
            <span className="truncate">{email}</span>
            {copied
                ? <Check size={12} className="shrink-0 theme-text-contrast" aria-label="Copied" />
                : <Copy size={12} className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden />}
        </button>
    )
}

function Identity({ member, onOpen, size = 40 }: { member: Member; onOpen: () => void; size?: number }) {
    return (
        <div className="flex items-center gap-3 min-w-0">
            <Avatar name={member.name} size={size} />
            <div className="min-w-0 flex flex-col">
                <button
                    type="button"
                    onClick={e => { e.stopPropagation(); onOpen() }}
                    className="text-left font-semibold theme-h1-color truncate hover:underline focus:outline-none focus-visible:ring-2 rounded"
                >
                    {member.name}
                </button>
                <span className="text-[12px] theme-subtext-color truncate">@{member.displayName}</span>
                <EmailButton email={member.email} />
            </div>
        </div>
    )
}

// ── Action menu (•••) ───────────────────────────────────────────────────

interface MemberActions {
    onEdit: (id: string) => void
    onManageTags: (id: string) => void
    onToggleBan: (id: string) => void
    onApprove: (id: string) => void
}

function ActionMenu({ member, actions }: { member: Member; actions: MemberActions }) {
    const [open, setOpen] = useState(false)
    const [up, setUp] = useState(false)
    const rootRef = useRef<HTMLDivElement>(null)
    const close = useCallback(() => setOpen(false), [])
    useOutsideClick(rootRef, open, close)

    useEffect(() => {
        if (!open) return
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
        document.addEventListener("keydown", onKey)
        return () => document.removeEventListener("keydown", onKey)
    }, [open])

    function toggle(e: ReactMouseEvent) {
        e.stopPropagation()
        if (!open) {
            const rect = rootRef.current?.getBoundingClientRect()
            const vh = window.visualViewport?.height ?? window.innerHeight
            setUp(!!rect && vh - rect.bottom < 200 && rect.top > vh - rect.bottom)
        }
        setOpen(o => !o)
    }

    const banned = member.status === "Banned"
    const run = (fn: (id: string) => void) => (e: ReactMouseEvent) => {
        e.stopPropagation()
        setOpen(false)
        fn(member.id)
    }
    const rowCls = "flex items-center gap-2.5 w-full px-3 py-2 text-sm text-left rounded-lg theme-text hover:bg-[color-mix(in_oklch,var(--theme-button-bg)_90%,transparent)] focus:outline-none focus-visible:ring-2"

    return (
        <div ref={rootRef} className="relative shrink-0">
            <button
                type="button"
                onClick={toggle}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={`Actions for ${member.name}`}
                className={iconBtnCls}
            >
                <MoreHorizontal size={18} />
            </button>
            {open && (
                <div
                    role="menu"
                    onClick={e => e.stopPropagation()}
                    className={`absolute right-0 z-40 w-52 rounded-xl border shadow-lg theme-bg theme-border p-1 flex flex-col ${up ? "bottom-full mb-1.5" : "top-full mt-1.5"}`}
                >
                    <button role="menuitem" type="button" className={rowCls} onClick={run(actions.onEdit)}>
                        <Pencil size={16} className="opacity-70" />Edit Member
                    </button>
                    <button role="menuitem" type="button" className={rowCls} onClick={run(actions.onManageTags)}>
                        <Tags size={16} className="opacity-70" />Manage Tags
                    </button>
                    {member.status === "Pending" && (
                        <button role="menuitem" type="button" className={rowCls} onClick={run(actions.onApprove)}>
                            <UserCheck size={16} className="opacity-70" />Approve Member
                        </button>
                    )}
                    <div className="my-1 border-t theme-border" />
                    <button
                        role="menuitem"
                        type="button"
                        onClick={run(actions.onToggleBan)}
                        className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-left rounded-lg hover:bg-[color-mix(in_oklch,#dc2626_10%,transparent)] focus:outline-none focus-visible:ring-2"
                        style={{ color: banned ? "var(--theme-text)" : "#dc2626" }}
                    >
                        {banned ? <ShieldCheck size={16} className="opacity-70" /> : <Ban size={16} />}
                        {banned ? "Unban Member" : "Ban Member"}
                    </button>
                </div>
            )}
        </div>
    )
}

// ── Member renderings ───────────────────────────────────────────────────

interface ItemProps {
    member: Member
    dirty: boolean
    actions: MemberActions
}

/** Pending-edit marker: a small accent dot next to the actions, paired with a
 *  tinted outline so it isn't colour-only (§5). */
function DirtyDot({ dirty }: { dirty: boolean }) {
    if (!dirty) return null
    return <span title="Unsaved changes" className="w-2 h-2 rounded-full shrink-0" style={{ background: "var(--theme-text-contrast)" }} />
}

function MemberCard({ member, dirty, actions }: ItemProps) {
    return (
        <div
            onClick={() => actions.onEdit(member.id)}
            className={`relative has-[[aria-expanded=true]]:z-20 rounded-xl border theme-border p-5 flex flex-col gap-3 cursor-pointer backdrop-blur-sm transition-opacity ${member.status === "Banned" ? "opacity-60 hover:opacity-90" : ""}`}
            style={{
                background: "color-mix(in oklch, var(--theme-bg) 92%, transparent)",
                ...(dirty ? { borderColor: accentTint(60), borderStyle: "dashed" } : {}),
            }}
        >
            <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0"><Identity member={member} onOpen={() => actions.onEdit(member.id)} /></div>
                <DirtyDot dirty={dirty} />
                <ActionMenu member={member} actions={actions} />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
                <SubteamBadge subteam={member.subteam} isLead={member.isLead} />
                <ExperiencePill member={member} />
                <StatusFlag status={member.status} />
            </div>
            <TagList tags={member.tags} />
        </div>
    )
}

function MemberRow({ member, dirty, actions }: ItemProps) {
    return (
        <div
            onClick={() => actions.onEdit(member.id)}
            className={`relative has-[[aria-expanded=true]]:z-20 flex items-center gap-3 px-4 py-2.5 cursor-pointer border-b last:border-b-0 theme-border transition-colors hover:bg-[color-mix(in_oklch,var(--theme-text-contrast)_6%,transparent)] first:rounded-t-xl last:rounded-b-xl ${member.status === "Banned" ? "opacity-60" : ""}`}
            style={dirty ? { background: accentTint(8) } : undefined}
        >
            <div className="flex-1 min-w-0 md:max-w-[34%]"><Identity member={member} onOpen={() => actions.onEdit(member.id)} size={32} /></div>
            <div className="hidden md:flex flex-wrap items-center gap-1.5 w-[30%]">
                <SubteamBadge subteam={member.subteam} isLead={member.isLead} />
                <ExperiencePill member={member} />
                <StatusFlag status={member.status} />
            </div>
            <div className="hidden lg:block flex-1 min-w-0"><TagList tags={member.tags} max={3} /></div>
            <DirtyDot dirty={dirty} />
            <ActionMenu member={member} actions={actions} />
        </div>
    )
}

function GroupedView({ members, isDirty, actions }: { members: Member[]; isDirty: (id: string) => boolean; actions: MemberActions }) {
    const [collapsed, setCollapsed] = useState<Set<Subteam>>(new Set())
    const groups = SUBTEAMS
        .map(s => ({ subteam: s, items: members.filter(x => x.subteam === s).sort(byLeadThenName) }))
        .filter(g => g.items.length)

    function toggle(s: Subteam) {
        setCollapsed(prev => {
            const next = new Set(prev)
            if (next.has(s)) next.delete(s)
            else next.add(s)
            return next
        })
    }

    return (
        <div className="flex flex-col gap-3">
            {groups.map(({ subteam, items }) => {
                const isOpen = !collapsed.has(subteam)
                const leads = items.filter(x => x.isLead).length
                const panelId = `group-${subteam}`
                return (
                    <section key={subteam} className="rounded-xl border theme-border theme-bg">
                        <button
                            type="button"
                            onClick={() => toggle(subteam)}
                            aria-expanded={isOpen}
                            aria-controls={panelId}
                            className={`flex items-center gap-3 w-full px-4 py-3 text-left focus:outline-none focus-visible:ring-2 rounded-xl ${isOpen ? "border-b theme-border rounded-b-none" : ""}`}
                        >
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: categoryStyle(subteam).color }} />
                            <span className="font-semibold theme-h1-color">{subteam}</span>
                            <span className="text-[12px] theme-subtext-color">
                                {items.length} {items.length === 1 ? "person" : "people"}{leads ? ` · ${leads} lead${leads > 1 ? "s" : ""}` : ""}
                            </span>
                            <ChevronDown size={15} className={`ml-auto theme-subtext-color transition-transform ${isOpen ? "rotate-180" : ""}`} />
                        </button>
                        {isOpen && (
                            <div id={panelId}>
                                {items.map(x => <MemberRow key={x.id} member={x} dirty={isDirty(x.id)} actions={actions} />)}
                            </div>
                        )}
                    </section>
                )
            })}
        </div>
    )
}

// ── Toolbar pieces ──────────────────────────────────────────────────────

const TABS: { key: TabKey; label: string; icon: ReactNode }[] = [
    { key: "active",  label: "Active Members",   icon: <Users size={16} /> },
    { key: "pending", label: "Pending Approval", icon: <Clock size={16} /> },
    { key: "mentors", label: "Mentors",          icon: <ShieldCheck size={16} /> },
    { key: "banned",  label: "Banned",           icon: <Ban size={16} /> },
]

function StatusTabs({ value, counts, onChange }: { value: TabKey; counts: Record<TabKey, number>; onChange: (t: TabKey) => void }) {
    return (
        <div role="tablist" aria-label="Member status" className="flex gap-1 overflow-x-auto theme-scrollbar border-b theme-border -mx-4 px-4 md:mx-0 md:px-0">
            {TABS.map(t => {
                const active = t.key === value
                return (
                    <button
                        key={t.key}
                        role="tab"
                        type="button"
                        aria-selected={active}
                        onClick={() => onChange(t.key)}
                        className={`relative flex items-center gap-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-opacity focus:outline-none focus-visible:ring-2 rounded-t-lg ${active ? "theme-text-contrast opacity-100" : "theme-text opacity-55 hover:opacity-80"}`}
                    >
                        {t.icon}
                        {t.label}
                        <span
                            className="min-w-[22px] rounded-full px-1.5 py-0.5 text-[11px] font-mono text-center"
                            style={{ background: active ? accentTint(16) : "color-mix(in oklch, var(--theme-border) 60%, transparent)" }}
                        >
                            {counts[t.key]}
                        </span>
                        {/* Underline marks the active tab by position as well as colour. */}
                        <span
                            className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full transition-opacity"
                            style={{ background: "var(--theme-text-contrast)", opacity: active ? 1 : 0 }}
                        />
                    </button>
                )
            })}
        </div>
    )
}

const VIEWS: { key: ViewMode; label: string; icon: ReactNode }[] = [
    { key: "grid",    label: "Card grid",          icon: <LayoutGrid size={16} /> },
    { key: "grouped", label: "Grouped by sub-team", icon: <Rows3 size={16} /> },
    { key: "list",    label: "Compact list",        icon: <List size={16} /> },
]

function ViewSwitcher({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
    return (
        <div role="group" aria-label="View mode" className="flex items-center rounded-lg border theme-border theme-bg p-0.5 shrink-0">
            {VIEWS.map(v => {
                const active = v.key === value
                return (
                    <button
                        key={v.key}
                        type="button"
                        title={v.label}
                        aria-label={v.label}
                        aria-pressed={active}
                        onClick={() => onChange(v.key)}
                        className={`flex items-center justify-center w-9 h-9 rounded-lg transition-opacity focus:outline-none focus-visible:ring-2 ${active ? "theme-text-contrast opacity-100" : "theme-text opacity-50 hover:opacity-90"}`}
                        style={active ? { background: accentTint(14) } : undefined}
                    >
                        {v.icon}
                    </button>
                )
            })}
        </div>
    )
}

// ── Inspector drawer ────────────────────────────────────────────────────

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            onClick={() => onChange(!checked)}
            className="relative w-11 h-6 rounded-full border theme-border transition-colors duration-200 focus:outline-none focus-visible:ring-2 shrink-0"
            style={{ background: checked ? "var(--theme-text-contrast)" : "color-mix(in oklch, var(--theme-border) 70%, transparent)" }}
        >
            <span
                className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200"
                style={{ transform: checked ? "translateX(20px)" : "translateX(0)" }}
            />
        </button>
    )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold theme-text">{label}</span>
            {children}
            {hint && <span className="text-[12px] theme-subtext-color opacity-80">{hint}</span>}
        </div>
    )
}

const SUBTEAM_OPTIONS: DropdownOption[] = SUBTEAMS.map(s => ({ value: s, label: s }))
const GRADE_EDIT_OPTIONS: DropdownOption[] = [{ value: "", label: "—" }, ...GRADES.map(g => ({ value: g, label: g }))]
const YEAR_EDIT_OPTIONS: DropdownOption[] = [{ value: "", label: "—" }, ...[1, 2, 3, 4].map(y => ({ value: String(y), label: `Year ${y}` }))]
const STATUS_OPTIONS: DropdownOption[] = STATUSES.map(s => ({ value: s, label: s }))

interface DrawerProps {
    member: Member | null
    focusTags: boolean
    dirty: boolean
    onPatch: (id: string, patch: Partial<Member>) => void
    onRevert: (id: string) => void
    onClose: () => void
}

function InspectorDrawer({ member, focusTags, dirty, onPatch, onRevert, onClose }: DrawerProps) {
    // Keep the last member around while the panel animates out.
    const [shown, setShown] = useState<Member | null>(member)
    const [visible, setVisible] = useState(false)
    const [tagInput, setTagInput] = useState("")
    const [tagError, setTagError] = useState<string | null>(null)
    const tagInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (member) {
            setShown(member)
            const raf = requestAnimationFrame(() => setVisible(true))
            return () => cancelAnimationFrame(raf)
        }
        setVisible(false)
        const t = window.setTimeout(() => setShown(null), 360)
        return () => window.clearTimeout(t)
    }, [member])

    const memberId = member?.id
    useEffect(() => {
        setTagInput("")
        setTagError(null)
    }, [memberId])

    useEffect(() => {
        if (memberId && focusTags) {
            const t = window.setTimeout(() => tagInputRef.current?.focus(), 200)
            return () => window.clearTimeout(t)
        }
    }, [memberId, focusTags])

    useEffect(() => {
        if (!member) return
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
        document.addEventListener("keydown", onKey)
        return () => document.removeEventListener("keydown", onKey)
    }, [member, onClose])

    if (!shown) return null
    const cur = member ?? shown
    const isMentor = cur.subteam === "Mentor"
    const patch = (p: Partial<Member>) => onPatch(cur.id, p)

    function addTag() {
        const tag = tagInput.trim().toLowerCase().replace(/\s+/g, "_")
        if (!TAG_RE.test(tag)) { setTagError("Use lowercase letters, numbers and underscores (1–64 characters)."); return }
        if (cur.tags.includes(tag)) { setTagError("That tag is already assigned."); return }
        patch({ tags: [...cur.tags, tag].sort() })
        setTagInput("")
        setTagError(null)
    }

    return (
        <div className="fixed inset-x-0 top-0 z-50" style={{ height: "var(--real-vh, 100dvh)" }} aria-hidden={!member}>
            <div
                onClick={onClose}
                className="absolute inset-0 transition-opacity motion-reduce:transition-none"
                style={{ background: "rgba(0,0,0,.45)", opacity: visible ? 1 : 0, transitionDuration: "360ms" }}
            />
            <aside
                role="dialog"
                aria-modal="true"
                aria-label={`Edit ${cur.name}`}
                className="absolute right-0 top-0 h-full w-full sm:max-w-md flex flex-col border-l theme-border theme-bg shadow-lg transition-transform motion-reduce:transition-none"
                style={{
                    transform: visible ? "translateX(0)" : "translateX(100%)",
                    transitionDuration: "360ms",
                    transitionTimingFunction: EASE_SHEET,
                    boxShadow: "0 12px 32px -10px rgba(0,0,0,.45)",
                }}
            >
                <header className="flex items-start gap-3 p-5 border-b theme-border">
                    <Avatar name={cur.name} size={48} />
                    <div className="flex-1 min-w-0 flex flex-col">
                        <span className="text-lg font-semibold theme-h1-color truncate">{cur.name}</span>
                        <span className="text-[12px] theme-subtext-color">@{cur.displayName}</span>
                        <EmailButton email={cur.email} />
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close" className={iconBtnCls}><X size={18} /></button>
                </header>

                <div className="flex-1 overflow-y-auto theme-scrollbar p-5 pb-28 flex flex-col gap-5">
                    <div className="flex flex-wrap gap-1.5">
                        <SubteamBadge subteam={cur.subteam} isLead={cur.isLead} />
                        <ExperiencePill member={cur} />
                        <StatusFlag status={cur.status} />
                    </div>

                    <h2 className="text-xs font-semibold uppercase tracking-widest theme-subtext-color">Role</h2>
                    <Field label="Sub-team">
                        <Dropdown
                            label="Sub-team"
                            value={cur.subteam}
                            options={SUBTEAM_OPTIONS}
                            triggerClassName={inputCls}
                            onChange={v => {
                                const subteam = v as Subteam
                                patch(subteam === "Mentor" ? { subteam, grade: null, year: null } : { subteam })
                            }}
                        />
                    </Field>
                    <div className="flex items-center justify-between gap-3 rounded-lg border theme-border px-3 py-2.5">
                        <div className="flex items-center gap-2 text-sm font-semibold theme-text">
                            <Crown size={16} className="theme-text-contrast" />
                            {isMentor ? "Lead mentor" : "Sub-team lead"}
                        </div>
                        <Toggle checked={cur.isLead} onChange={isLead => patch({ isLead })} label="Lead" />
                    </div>

                    <h2 className="text-xs font-semibold uppercase tracking-widest theme-subtext-color">Experience</h2>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Grade">
                            <Dropdown
                                label="Grade"
                                value={cur.grade ?? ""}
                                options={GRADE_EDIT_OPTIONS}
                                disabled={isMentor}
                                triggerClassName={inputCls}
                                onChange={v => patch({ grade: (v || null) as Grade | null })}
                            />
                        </Field>
                        <Field label="Year on team">
                            <Dropdown
                                label="Year on team"
                                value={cur.year ? String(cur.year) : ""}
                                options={YEAR_EDIT_OPTIONS}
                                disabled={isMentor}
                                triggerClassName={inputCls}
                                onChange={v => patch({ year: v ? Number(v) : null })}
                            />
                        </Field>
                    </div>
                    {isMentor && <p className="text-[12px] theme-subtext-color -mt-3">Mentors don't have a grade or team year.</p>}

                    <h2 className="text-xs font-semibold uppercase tracking-widest theme-subtext-color">Tags</h2>
                    <div className="flex flex-wrap gap-1.5 min-h-[24px]">
                        {cur.tags.length === 0 && <span className="text-[12px] theme-subtext-color">No tags yet.</span>}
                        {cur.tags.map(t => (
                            <TagPill key={t} tag={t} onRemove={() => patch({ tags: cur.tags.filter(x => x !== t) })} />
                        ))}
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <div className="flex gap-2">
                            <input
                                ref={tagInputRef}
                                value={tagInput}
                                onChange={e => { setTagInput(e.target.value); setTagError(null) }}
                                onKeyDown={e => { if (e.key === "Enter") addTag() }}
                                placeholder="new_tag"
                                aria-label="New tag"
                                className={inputCls}
                                style={tagError ? { borderColor: DANGER.borderColor } : undefined}
                            />
                            <button
                                type="button"
                                onClick={addTag}
                                disabled={!tagInput.trim()}
                                className="flex items-center gap-1.5 rounded-lg border theme-border theme-bg px-3 text-sm font-semibold theme-text-contrast hover:opacity-80 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2"
                            >
                                <Plus size={16} />Add
                            </button>
                        </div>
                        {tagError && <span className="text-[12px]" style={{ color: DANGER.color }}>{tagError}</span>}
                    </div>

                    <h2 className="text-xs font-semibold uppercase tracking-widest theme-subtext-color">Account</h2>
                    <Field label="Status" hint="Banned members lose access and drop out of the main roster.">
                        <Dropdown
                            label="Status"
                            value={cur.status}
                            options={STATUS_OPTIONS}
                            triggerClassName={inputCls}
                            onChange={v => patch({ status: v as Status })}
                        />
                    </Field>

                    {dirty && (
                        <button
                            type="button"
                            onClick={() => onRevert(cur.id)}
                            className="self-start flex items-center gap-1.5 text-sm theme-subtext-color hover:opacity-80 transition-opacity rounded focus:outline-none focus-visible:ring-2"
                        >
                            <RotateCcw size={14} />Revert this member's changes
                        </button>
                    )}
                </div>
            </aside>
        </div>
    )
}

// ── Unsaved-changes bar ─────────────────────────────────────────────────

function UnsavedBar({ count, saving, justSaved, onReset, onSave }: {
    count: number; saving: boolean; justSaved: boolean; onReset: () => void; onSave: () => void
}) {
    const show = count > 0 || justSaved
    return (
        <div
            className="fixed left-1/2 z-[60] w-[calc(100%-32px)] max-w-lg transition-all motion-reduce:transition-none"
            style={{
                bottom: 24,
                transform: `translate(-50%, ${show ? "0" : "calc(100% + 32px)"})`,
                opacity: show ? 1 : 0,
                transitionDuration: "340ms",
                transitionTimingFunction: EASE_SHEET,
                pointerEvents: show ? "auto" : "none",
            }}
            role="status"
            aria-live="polite"
        >
            <div className="flex items-center gap-3 rounded-xl border theme-border theme-bg shadow-lg pl-4 pr-2 py-2" style={{ boxShadow: "0 12px 32px -10px rgba(0,0,0,.45)" }}>
                {count > 0 ? (
                    <>
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "var(--theme-text-contrast)" }} />
                        <span className="text-sm font-medium theme-text flex-1">
                            {count} member{count > 1 ? "s" : ""} with unsaved changes
                        </span>
                        <button
                            type="button"
                            onClick={onReset}
                            disabled={saving}
                            className="rounded-lg px-3 py-2 text-sm font-medium theme-text opacity-70 hover:opacity-100 transition-opacity disabled:opacity-40 focus:outline-none focus-visible:ring-2"
                        >
                            Reset
                        </button>
                        <button
                            type="button"
                            onClick={onSave}
                            disabled={saving}
                            className="rounded-lg border theme-border px-4 py-2 text-sm font-semibold theme-text-contrast theme-button-bg hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2"
                        >
                            {saving ? "Saving…" : "Save changes"}
                        </button>
                    </>
                ) : (
                    <span className="flex items-center gap-2 py-2 text-sm font-medium theme-text-contrast">
                        <Check size={16} />Changes saved
                    </span>
                )}
            </div>
        </div>
    )
}

// ── Page ────────────────────────────────────────────────────────────────

const ALL = "__all"

export default function MembersDirectory() {
    const [base, setBase] = useState<Member[]>(MOCK_MEMBERS)
    const [drafts, setDrafts] = useState<Record<string, Partial<Member>>>({})
    const [tab, setTab] = useState<TabKey>("active")
    const [view, setView] = useState<ViewMode>("grid")
    const [query, setQuery] = useState("")
    const [subteamFilter, setSubteamFilter] = useState(ALL)
    const [gradeFilter, setGradeFilter] = useState(ALL)
    const [inspector, setInspector] = useState<{ id: string; tags: boolean } | null>(null)
    const [saving, setSaving] = useState(false)
    const [justSaved, setJustSaved] = useState(false)

    const effective = useMemo(() => base.map(x => (drafts[x.id] ? { ...x, ...drafts[x.id] } : x)), [base, drafts])
    const byId = useMemo(() => new Map(effective.map(x => [x.id, x])), [effective])
    const isDirty = useCallback((id: string) => id in drafts, [drafts])

    /** Merge a patch into a member's draft, dropping fields that are back to
     *  their saved value so the unsaved count never lies. */
    const patchMember = useCallback((id: string, p: Partial<Member>) => {
        const orig = base.find(x => x.id === id)
        if (!orig) return
        setDrafts(prev => {
            const merged: Partial<Member> = { ...prev[id], ...p }
            for (const k of Object.keys(merged) as (keyof Member)[]) {
                if (sameValue(merged[k], orig[k])) delete merged[k]
            }
            const next = { ...prev }
            if (Object.keys(merged).length) next[id] = merged
            else delete next[id]
            return next
        })
        setJustSaved(false)
    }, [base])

    const revertMember = useCallback((id: string) => {
        setDrafts(prev => {
            const next = { ...prev }
            delete next[id]
            return next
        })
    }, [])

    const actions = useMemo<MemberActions>(() => ({
        onEdit: id => setInspector({ id, tags: false }),
        onManageTags: id => setInspector({ id, tags: true }),
        onToggleBan: id => {
            const cur = byId.get(id)
            if (!cur) return
            const orig = base.find(x => x.id === id)
            // Unbanning returns someone to whatever status they had before, or
            // Approved if they were banned when the page loaded.
            const restore = orig && orig.status !== "Banned" ? orig.status : "Approved"
            patchMember(id, { status: cur.status === "Banned" ? restore : "Banned" })
        },
        onApprove: id => patchMember(id, { status: "Approved" }),
    }), [byId, base, patchMember])

    const counts = useMemo(() => {
        const c: Record<TabKey, number> = { active: 0, pending: 0, mentors: 0, banned: 0 }
        for (const x of effective) c[tabOf(x)] += 1
        return c
    }, [effective])

    const q = query.trim().toLowerCase()
    const visible = useMemo(() => effective
        .filter(x => tabOf(x) === tab)
        .filter(x => subteamFilter === ALL || x.subteam === subteamFilter)
        .filter(x => gradeFilter === ALL || x.grade === gradeFilter)
        .filter(x => matchesQuery(x, q))
        .sort(byLeadThenName), [effective, tab, subteamFilter, gradeFilter, q])

    const subteamOptions: DropdownOption[] = [{ value: ALL, label: "All sub-teams" }, ...SUBTEAM_OPTIONS]
    const gradeOptions: DropdownOption[] = [{ value: ALL, label: "All grades" }, ...GRADES.map(g => ({ value: g, label: g }))]
    const filtersActive = q !== "" || subteamFilter !== ALL || gradeFilter !== ALL

    function clearFilters() {
        setQuery("")
        setSubteamFilter(ALL)
        setGradeFilter(ALL)
    }

    const handleSave = useCallback(() => {
        setSaving(true)
        // Stand-in for the PUT /members + approve/ban calls MembersPage makes.
        window.setTimeout(() => {
            setBase(effective)
            setDrafts({})
            setSaving(false)
            setJustSaved(true)
            window.setTimeout(() => setJustSaved(false), 1800)
        }, 600)
    }, [effective])

    const closeInspector = useCallback(() => setInspector(null), [])
    const inspected = inspector ? byId.get(inspector.id) ?? null : null
    const dirtyCount = Object.keys(drafts).length

    return (
        <div className="px-4 py-6 flex flex-col gap-4 max-w-7xl mx-auto w-full">
            <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold theme-h1-color">Members</h1>
                    <p className="text-sm theme-subtext-color">
                        {effective.length} people across {SUBTEAMS.length - 1} sub-teams and mentors.
                    </p>
                </div>
                <ViewSwitcher value={view} onChange={setView} />
            </div>

            <StatusTabs value={tab} counts={counts} onChange={setTab} />

            <div className="flex flex-col md:flex-row md:items-center gap-2">
                <div className="relative flex-1">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 theme-subtext-color pointer-events-none" />
                    <input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Search by name, handle, email or tag"
                        aria-label="Search members"
                        className={`${inputCls} pl-9 pr-9`}
                    />
                    {query && (
                        <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center justify-center w-8 h-8 theme-subtext-color hover:opacity-70">
                            <X size={14} />
                        </button>
                    )}
                </div>
                <div className="flex gap-2">
                    <Dropdown label="Sub-team" className="flex-1 md:w-44" value={subteamFilter} options={subteamOptions} onChange={setSubteamFilter} triggerClassName={`${triggerCls} py-2.5`} />
                    <Dropdown label="Grade" className="flex-1 md:w-36" value={gradeFilter} options={gradeOptions} onChange={setGradeFilter} triggerClassName={`${triggerCls} py-2.5`} menuAlign="right" />
                </div>
            </div>

            {filtersActive && (
                <div className="flex items-center gap-2 text-[12px] theme-subtext-color -mt-1">
                    <span>{visible.length} match{visible.length === 1 ? "" : "es"}</span>
                    <button type="button" onClick={clearFilters} className="theme-text-contrast font-semibold hover:underline">Clear filters</button>
                </div>
            )}

            {visible.length === 0 ? (
                <div className="rounded-xl border border-dashed theme-border p-8 flex flex-col items-center gap-2 text-center">
                    <Users size={21} className="theme-subtext-color" />
                    <p className="text-sm font-semibold theme-text">No members here</p>
                    <p className="text-[12px] theme-subtext-color">
                        {filtersActive ? "Try a different search or clear the filters." : "Nobody is in this list right now."}
                    </p>
                </div>
            ) : view === "grid" ? (
                <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
                    {visible.map(x => <MemberCard key={x.id} member={x} dirty={isDirty(x.id)} actions={actions} />)}
                </div>
            ) : view === "grouped" ? (
                <GroupedView members={visible} isDirty={isDirty} actions={actions} />
            ) : (
                <div className="rounded-xl border theme-border theme-bg">
                    {visible.map(x => <MemberRow key={x.id} member={x} dirty={isDirty(x.id)} actions={actions} />)}
                </div>
            )}

            {/* Room so the floating bar never covers the last row. */}
            <div className="h-20" aria-hidden />

            <InspectorDrawer
                member={inspected}
                focusTags={inspector?.tags ?? false}
                dirty={inspected ? isDirty(inspected.id) : false}
                onPatch={patchMember}
                onRevert={revertMember}
                onClose={closeInspector}
            />
            <UnsavedBar count={dirtyCount} saving={saving} justSaved={justSaved} onReset={() => setDrafts({})} onSave={handleSave} />
        </div>
    )
}
