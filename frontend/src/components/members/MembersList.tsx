import { useMemo, useState, type ReactNode } from "react"
import { ChevronRight, Pencil, ScanLine, Tag } from "lucide-react"
import Button from "@/components/ui/Button"
import EmptyState from "@/components/ui/EmptyState"
import Notice from "@/components/ui/Notice"
import Sheet from "@/components/ui/Sheet"
import type { RoleCatalogEntry } from "@/lib/permissions"
import { focusRing, helperClass, inputClass } from "@/lib/uiClasses"
import {
    STATUS_LABEL, TABS,
    goesByOf, gradeLabel, groupRoster, kioskGrantLabel, kioskGrantOf, nameOf, pretty, roleTextOf, statusOf, tagChip,
    type MemberActions, type MemberRow, type RosterOrder, type RowAction, type Status, type Tab,
} from "@/lib/members"
import { LeadBadge, MemberAvatar, MembersSkeleton } from "./MemberBits"

interface MembersListProps {
    members: MemberRow[]
    loading: boolean
    order: RosterOrder
    /** Search and status tab live on the page, so they survive a switch to the desktop grid and back. */
    query: string
    onQueryChange: (query: string) => void
    tab: Tab
    onTabChange: (tab: Tab) => void
    actions: MemberActions
}

/**
 * The phone roster: status tabs and search, then the members grouped by subteam
 * (captains and mentors first, alumni and visitors after, banned accounts last),
 * each group's header sticking to the top while its members scroll. Search matches role
 * names too, so "cad" finds the CAD subteam. Tapping a member opens a sheet with
 * every action the desktop grid spreads across its columns.
 */
export default function MembersList({ members, loading, order, query, onQueryChange, tab, onTabChange, actions }: MembersListProps) {
    // The member whose sheet is open.
    const [sheetFor, setSheetFor] = useState<string | null>(null)
    const { roleById } = actions

    const ql = query.trim().toLowerCase()
    // Search first; tab counts are computed over this set.
    const base = useMemo(() => !ql ? members : members.filter(m =>
        [m.name, m.display_name, m.email, m.role ? (roleById.get(m.role)?.label ?? pretty(m.role)) : ""]
            .some(v => v?.toLowerCase().includes(ql))), [members, ql, roleById])
    const groups = useMemo(
        () => groupRoster(base.filter(m => tab === "all" || statusOf(m) === tab), order),
        [base, tab, order])

    const sheetMember = sheetFor ? members.find(m => m.id === sheetFor) : undefined
    /** Closes the member's sheet before opening another, so they never stack. */
    const thenClose = (open: (() => void) | undefined) => open && (() => { setSheetFor(null); open() })

    return (
        <>
            <div className="flex flex-col gap-3 px-4 py-3 border-b theme-border">
                <div className="flex gap-1 p-1 rounded-xl max-w-full overflow-x-auto" style={{ background: "var(--ag-grid-chrome-bg)" }}>
                    {TABS.map(([k, label]) => (
                        <button
                            key={k}
                            onClick={() => onTabChange(k)}
                            className={`flex items-center gap-1.5 px-3 min-h-11 rounded-lg text-sm whitespace-nowrap cursor-pointer ${focusRing}`}
                            style={{
                                background: tab === k ? "var(--theme-button-hover)" : "transparent",
                                color: tab === k ? "var(--theme-h1-color)" : "var(--theme-subtext-color)",
                            }}
                        >
                            {label}
                            <span className="opacity-70">
                                {k === "all" ? base.length : base.filter(m => statusOf(m) === k).length}
                            </span>
                        </button>
                    ))}
                </div>
                <input
                    value={query}
                    onChange={e => onQueryChange(e.target.value)}
                    placeholder="Search name, email, role, subteam…"
                    className={`members-search w-full ${inputClass}`}
                    aria-label="Search members"
                    style={{ background: "var(--ag-grid-chrome-bg)" }}
                />
            </div>

            <div className="flex flex-col">
                {loading ? <MembersSkeleton /> : groups.length === 0 ? (
                    <div className="px-4 py-6">
                        <EmptyState>No members match these filters.</EmptyState>
                    </div>
                ) : groups.map(g => (
                    <div key={g.key} className="flex flex-col">
                        <div className="sticky top-0 z-10 flex items-baseline gap-2.5 px-4 pt-3.5 pb-2 border-b theme-border theme-bg">
                            <span className="text-sm font-semibold theme-h1-color">{g.name}</span>
                            <span className="text-xs theme-subtext-color">{g.rows.length}</span>
                        </div>
                        {g.rows.map(m => (
                            <MemberListRow
                                key={m.id}
                                member={m}
                                role={m.role ? roleById.get(m.role) : undefined}
                                onOpen={() => setSheetFor(m.id)}
                            />
                        ))}
                    </div>
                ))}
            </div>

            {sheetMember && (
                <MemberSheet
                    member={sheetMember}
                    role={sheetMember.role ? roleById.get(sheetMember.role) : undefined}
                    action={actions.actionFor(sheetMember)}
                    onClose={() => setSheetFor(null)}
                    onEdit={thenClose(actions.onEdit(sheetMember))}
                    onEditTags={thenClose(actions.onEditTags(sheetMember))}
                    kioskBlocked={actions.kioskBlocked(sheetMember)}
                    onKioskAccess={() => { setSheetFor(null); actions.onKioskAccess(sheetMember) }}
                />
            )}

            <style>{`
                .members-search::placeholder { color: var(--theme-subtext-color); opacity: .7; }
                .members-list-row:active { background: var(--ag-grid-hover-bg); }
            `}</style>
        </>
    )
}

/** Small status chip for the list; approved members carry none to keep rows quiet. */
function StatusPill({ status }: { status: Status }) {
    return (
        <span
            className="text-xs font-semibold px-2 py-0.5 rounded-full shrink-0"
            style={status === "pending"
                ? tagChip
                : { background: "var(--theme-button-hover)", color: "var(--theme-subtext-color)" }}
        >
            {STATUS_LABEL[status]}
        </span>
    )
}

interface MemberListRowProps {
    member: MemberRow
    role: RoleCatalogEntry | undefined
    onOpen: () => void
}

/** One roster row: the whole row is one tap target that opens the member's sheet. */
function MemberListRow({ member: m, role, onOpen }: MemberListRowProps) {
    const name = nameOf(m)
    const status = statusOf(m)
    const sub = [roleTextOf(m, role), gradeLabel(m.grade, m.team_year)].filter(v => v !== "—").join(" · ")

    return (
        <button
            type="button"
            onClick={onOpen}
            className={`members-list-row w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer ${focusRing}`}
            style={{ borderBottom: "1px solid var(--ag-grid-row-border)", opacity: m.banned_at ? 0.6 : 1 }}
        >
            <MemberAvatar name={name} picture={m.picture} size={40} />
            <span className="flex flex-col gap-1 flex-1 min-w-0">
                <span className="flex items-center gap-2 min-w-0">
                    <span className="text-base font-medium truncate theme-h1-color">{name}</span>
                    {role?.level === "lead" && <LeadBadge />}
                </span>
                <span className="text-xs truncate theme-subtext-color">{sub || goesByOf(m) || "No role"}</span>
                {m.tags.length > 0 && (
                    <span className="flex flex-wrap gap-1">
                        {m.tags.map(t => (
                            <span key={t} className="text-xs px-1.5 py-0.5 rounded-full" style={tagChip}>{t}</span>
                        ))}
                    </span>
                )}
            </span>
            {kioskGrantOf(m) && <ScanLine size={16} className="shrink-0 theme-text-contrast" aria-label="Has kiosk access" />}
            {status !== "approved" && <StatusPill status={status} />}
            <ChevronRight size={18} className="shrink-0 theme-subtext-color" />
        </button>
    )
}

interface MemberSheetProps {
    member: MemberRow
    role: RoleCatalogEntry | undefined
    action: RowAction
    onClose: () => void
    /** Absent when the member is outside the viewer's editing scope. */
    onEdit?: () => void
    onEditTags?: () => void
    /** Why kiosk access can't be changed for this member; undefined when it can. */
    kioskBlocked?: string
    onKioskAccess: () => void
}

/**
 * Bottom sheet for one member: their details plus every action the desktop row
 * spreads across columns (profile edit, tags, kiosk access, approve/ban/unban).
 * Approve, ban and unban save straight away and close the sheet; a failure shows here.
 */
function MemberSheet({ member: m, role, action, onClose, onEdit, onEditTags, kioskBlocked, onKioskAccess }: MemberSheetProps) {
    const name = nameOf(m)
    const goesBy = goesByOf(m)
    const kiosk = kioskGrantOf(m)
    const Icon = action.icon
    const [actionError, setActionError] = useState<string | null>(null)

    const runAction = async () => {
        setActionError(null)
        try {
            if (await action.run()) onClose()
        } catch (e) {
            setActionError(e instanceof Error ? e.message : `Couldn't ${action.label.toLowerCase()} ${name}`)
        }
    }

    const details: [string, ReactNode][] = [
        ["Email", m.email ?? "Hidden"],
        ["Role", (
            <span className="flex items-center justify-end gap-2">
                {role?.label ?? (m.role ? pretty(m.role) : "—")}
                {role?.level === "lead" && <LeadBadge />}
            </span>
        )],
        ["Grade", gradeLabel(m.grade, m.team_year)],
        ["Status", STATUS_LABEL[statusOf(m)]],
        ["Kiosk access", kiosk ? kioskGrantLabel(kiosk) : "None"],
    ]

    return (
        <Sheet title={name} onClose={onClose}>
            <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                    <MemberAvatar name={name} picture={m.picture} size={44} />
                    <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-base font-semibold truncate theme-h1-color">{name}</span>
                        {goesBy && <span className="text-xs truncate theme-subtext-color">{goesBy}</span>}
                    </div>
                </div>

                <dl className="flex flex-col rounded-xl border theme-border">
                    {details.map(([label, value], i) => (
                        <div
                            key={label}
                            className="flex items-center justify-between gap-4 px-4 py-2.5"
                            style={i ? { borderTop: "1px solid var(--ag-grid-row-border)" } : undefined}
                        >
                            <dt className="text-xs shrink-0 theme-subtext-color">{label}</dt>
                            <dd className="text-sm text-right min-w-0 truncate theme-text">{value}</dd>
                        </div>
                    ))}
                </dl>

                {(m.tags.length > 0 || onEditTags) && (
                    <div className="flex flex-col gap-2">
                        <span className="text-xs theme-subtext-color">Tags</span>
                        <div className="flex flex-wrap gap-1.5">
                            {m.tags.length === 0 && <span className="text-xs theme-subtext-color">No tags yet</span>}
                            {m.tags.map(t => (
                                <span key={t} className="text-xs px-2 py-0.5 rounded-full" style={tagChip}>{t}</span>
                            ))}
                        </div>
                    </div>
                )}

                <div className="flex flex-col gap-2">
                    {onEdit && (
                        <Button className="w-full" onClick={onEdit}>
                            <Pencil size={16} /> Edit profile &amp; role
                        </Button>
                    )}
                    {onEditTags && (
                        <Button variant="outlined" className="w-full" onClick={onEditTags}>
                            <Tag size={16} /> Edit tags
                        </Button>
                    )}
                    <Button variant="outlined" className="w-full" onClick={onKioskAccess} disabled={!!kioskBlocked}>
                        <ScanLine size={16} /> {kiosk ? "Change kiosk access" : "Grant kiosk access"}
                    </Button>
                    {kioskBlocked && <p className={`text-center ${helperClass}`}>{kioskBlocked}</p>}
                    <Button
                        variant="outlined"
                        className="w-full"
                        onClick={() => void runAction()}
                        disabled={action.disabled}
                    >
                        <Icon size={16} /> {action.label}
                    </Button>
                    {action.disabled && action.reason && (
                        <p className={`text-center ${helperClass}`}>{action.reason}</p>
                    )}
                    {actionError && <Notice>{actionError}</Notice>}
                </div>
            </div>
        </Sheet>
    )
}
