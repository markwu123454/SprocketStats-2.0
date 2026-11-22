import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { createPortal } from "react-dom"
import { AgGridReact } from "ag-grid-react"
import type {
    ColDef, EditableCallbackParams, ICellRendererParams,
    RowClassParams, SuppressKeyboardEventParams, ValueGetterParams, ValueSetterParams,
} from "ag-grid-community"
import "@/lib/agGrid"
import { Check, MoreHorizontal, Pencil, ScanLine, Tag, X } from "lucide-react"
import EmptyState from "@/components/ui/EmptyState"
import type { RoleCatalogEntry } from "@/lib/permissions"
import { focusRing, menuRowClass } from "@/lib/uiClasses"
import {
    GRADE_OPTIONS, STATUS_LABEL, YEAR_OPTIONS,
    goesByOf, kioskGrantLabel, kioskGrantOf, nameOf, norm, pretty, roleTextOf, statusOf, tagChip,
    type EditableField, type MemberActions, type MemberRow, type ProfilePatch, type Status,
} from "@/lib/members"
import { LeadBadge, MemberAvatar } from "./MemberBits"

/** The grid's `context` is fixed when it's created, so cells reach the page's latest actions through this. */
interface GridContext { actions: () => MemberActions }
type CellProps = ICellRendererParams<MemberRow, unknown, GridContext>

/**
 * Lets Tab step through the buttons inside a cell before the grid moves to the next
 * cell, and lets Enter/Space press a focused button instead of the grid acting on
 * the cell (AG Grid's pattern for interactive cell renderers).
 */
function cellButtonKeys({ event }: SuppressKeyboardEventParams<MemberRow>): boolean {
    const target = event.target as HTMLElement
    if ((event.key === "Enter" || event.key === " ") && target.closest("button")) return true
    if (event.key !== "Tab") return false
    const cell = target.closest(".ag-cell")
    const buttons = cell ? [...cell.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")] : []
    const next = buttons.indexOf(target as HTMLButtonElement) + (event.shiftKey ? -1 : 1)
    if (event.shiftKey && target === cell) return false
    if (next < 0 || next >= buttons.length) return false
    event.preventDefault()
    buttons[next].focus()
    return true
}

/** The grid's own column filters: a "contains" text box per column, matching what the cell shows (`filterText`). */
const DEFAULT_COL_DEF: ColDef<MemberRow> = {
    sortable: true, resizable: true, suppressMovable: true, cellClass: "members-cell",
    filter: "agTextColumnFilter",
    filterParams: { filterOptions: ["contains"], maxNumConditions: 1 },
}

/** A column filter's text for a member: what their cell shows. */
const filterText = (text: (m: MemberRow) => string) => (p: ValueGetterParams<MemberRow>) =>
    (p.data ? text(p.data) : "")

const ROW_CLASS_RULES = {
    "members-banned": (p: RowClassParams<MemberRow>) => !!p.data?.banned_at,
}

const STATUS_ORDER: Status[] = ["pending", "approved", "banned"]

interface MembersGridProps {
    members: MemberRow[]
    catalog: RoleCatalogEntry[]
    /** Roster order (by group, leads first, then name; banned last): what sorting by Role uses. */
    compareRoster: (a: MemberRow, b: MemberRow) => number
    /** Captains, Mentors and the Scouting Lead: may change roles. */
    canManage: boolean
    canEditMember: (role: string | null) => boolean
    /** Saves an in-place edit right away; the page reports a failure. */
    onUpdate: (member: MemberRow, patch: ProfilePatch) => void
    actions: MemberActions
}

/**
 * The desktop roster: one row per member, starting sorted by Role in roster order
 * (captains, mentors, each subteam with its leads first, alumni, visitors; banned
 * last). Every column sorts and has the grid's own "contains" filter. Role (for
 * those who may change it), Grade and Year are edited in place with a single
 * click and save straight away; name and display name stay in the profile
 * editor, opened by clicking the member.
 *
 * Loaded on its own (MembersPage imports it lazily), so phones never download AG Grid.
 */
export default function MembersGrid({ members, catalog, compareRoster, canManage, canEditMember, onUpdate, actions }: MembersGridProps) {
    const gridRef = useRef<AgGridReact<MemberRow>>(null)
    const actionsRef = useRef(actions)
    const onUpdateRef = useRef(onUpdate)
    useLayoutEffect(() => { actionsRef.current = actions; onUpdateRef.current = onUpdate })
    const [context] = useState<GridContext>(() => ({ actions: () => actionsRef.current }))

    // The grid only redraws a cell when its own value changes, but most cells show more
    // than that value: the member cell its display name, the status
    // cell the kiosk badge, the actions cell the approve/ban button. They also read role
    // labels and permissions through `context`, which the grid doesn't watch. So redraw
    // every cell when a row or any of those changes; the roster is small enough for that.
    useEffect(() => {
        gridRef.current?.api?.refreshCells({ force: true })
    }, [members, actions.roleById, canManage, canEditMember])

    // Depends only on things that rarely change: new column definitions would reset
    // the widths someone dragged.
    const columnDefs = useMemo<ColDef<MemberRow>[]>(() => {
        const roleById = new Map(catalog.map(c => [c.value, c]))
        const roleLabel = (v: unknown) => (typeof v === "string" && v ? roleById.get(v)?.label ?? pretty(v) : "—")
        const byPosition = (list: readonly string[]) => (a: unknown, b: unknown) =>
            list.indexOf(String(a ?? "")) - list.indexOf(String(b ?? ""))
        const mayEdit = (p: EditableCallbackParams<MemberRow>) => !!p.data && canEditMember(p.data.role)
        const save = (field: EditableField) => (p: ValueSetterParams<MemberRow>) => {
            const value = norm(p.newValue as string | null)
            if (p.data && value !== norm(p.data[field])) onUpdateRef.current(p.data, { [field]: value })
            return false // the page owns the row; its re-render brings the new value in
        }
        return [
            {
                colId: "member", headerName: "Member", flex: 1.6, minWidth: 180,
                valueGetter: p => (p.data ? nameOf(p.data) : ""),
                comparator: (a, b) => String(a).localeCompare(String(b)),
                filterValueGetter: filterText(m => `${nameOf(m)} ${m.display_name ?? ""}`),
                cellRenderer: MemberCell, suppressKeyboardEvent: cellButtonKeys,
            },
            {
                colId: "email", headerName: "Email", flex: 1.4, minWidth: 140,
                valueGetter: p => p.data?.email ?? null,
                valueFormatter: p => (p.value as string | null) ?? "Hidden",
                comparator: (a, b) => (a == null ? 1 : b == null ? -1 : String(a).localeCompare(String(b))),
                filterValueGetter: filterText(m => m.email ?? "Hidden"),
                cellClass: "members-cell text-xs theme-subtext-color",
            },
            {
                colId: "role", headerName: "Role", flex: 1.3, minWidth: 140,
                initialSort: "asc",
                valueGetter: p => p.data?.role ?? "",
                valueFormatter: p => roleLabel(p.value),
                comparator: (_a, _b, nodeA, nodeB) => (nodeA.data && nodeB.data ? compareRoster(nodeA.data, nodeB.data) : 0),
                filterValueGetter: filterText(m => `${roleLabel(m.role)} ${roleTextOf(m, m.role ? roleById.get(m.role) : undefined)}`),
                cellRenderer: RoleCell,
                editable: p => canManage && !!p.data,
                cellEditor: "agSelectCellEditor",
                cellEditorParams: { values: catalog.map(c => c.value) },
                valueSetter: save("role"),
                headerTooltip: canManage ? "Click a role to change it" : undefined,
            },
            {
                colId: "grade", headerName: "Grade", width: 100,
                valueGetter: p => p.data?.grade ?? "",
                valueFormatter: p => (p.value ? pretty(String(p.value)) : "—"),
                comparator: byPosition(GRADE_OPTIONS),
                filterValueGetter: filterText(m => (m.grade ? pretty(m.grade) : "")),
                editable: mayEdit,
                cellEditor: "agSelectCellEditor",
                cellEditorParams: { values: GRADE_OPTIONS },
                valueSetter: save("grade"),
            },
            {
                colId: "year", headerName: "Year", width: 80,
                valueGetter: p => p.data?.team_year ?? "",
                valueFormatter: p => (p.value ? `Yr ${String(p.value).replace("year_", "")}` : "—"),
                comparator: byPosition(YEAR_OPTIONS),
                filterValueGetter: filterText(m => (m.team_year ? `Yr ${m.team_year.replace("year_", "")}` : "")),
                editable: mayEdit,
                cellEditor: "agSelectCellEditor",
                cellEditorParams: { values: YEAR_OPTIONS },
                valueSetter: save("team_year"),
            },
            {
                colId: "status", headerName: "Status", width: 130,
                valueGetter: p => (p.data ? statusOf(p.data) : ""),
                comparator: byPosition(STATUS_ORDER),
                filterValueGetter: filterText(m => `${STATUS_LABEL[statusOf(m)]}${kioskGrantOf(m) ? " Kiosk" : ""}`),
                cellRenderer: StatusCell,
            },
            {
                colId: "tags", headerName: "Tags", flex: 1, minWidth: 100, sortable: false,
                valueGetter: p => p.data?.tags.join(" ") ?? "",
                filterValueGetter: filterText(m => m.tags.join(" ")),
                cellRenderer: TagsCell, suppressKeyboardEvent: cellButtonKeys,
            },
            {
                colId: "actions", headerName: "", width: 80, pinned: "right", sortable: false, resizable: false, filter: false,
                cellRenderer: ActionsCell, suppressKeyboardEvent: cellButtonKeys,
            },
        ]
    }, [catalog, compareRoster, canManage, canEditMember])

    return (
        <div className="members-grid flex-1 min-h-0">
            <AgGridReact<MemberRow>
                ref={gridRef}
                rowData={members}
                columnDefs={columnDefs}
                defaultColDef={DEFAULT_COL_DEF}
                context={context}
                getRowId={p => p.data.id}
                rowHeight={56}
                rowClass="members-row"
                rowClassRules={ROW_CLASS_RULES}
                singleClickEdit
                stopEditingWhenCellsLoseFocus
                noRowsOverlayComponent={NoMembersOverlay}
            />

            {/* Hover-only affordances are gated on real hover so a tap on touch screens
                isn't swallowed as a hover, and the tag button stays visible without one. */}
            <style>{`
                /* Grid cells: centre custom content, and don't inherit the grid's row-height line-height. */
                .members-cell { display: flex; align-items: center; line-height: 1.35; }
                .members-banned .ag-cell { opacity: .6; }
                .members-grid .ag-body-viewport, .members-grid .ag-body-horizontal-scroll-viewport, .members-grid .ag-center-cols-viewport {
                    scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
                }
                /* Under the pinned actions column the grid keeps a spacer the height of the horizontal
                   scrollbar, drawn as an empty scrollbar of its own. Keep the space, drop the stray bar. */
                .members-grid .ag-horizontal-right-spacer { overflow-x: hidden; }
                @media (hover: hover) {
                    .members-row:hover .members-tag-edit { opacity: 1; }
                    .members-action:not(:disabled):hover { border-color: var(--theme-border); color: var(--theme-h1-color); }
                    .members-menu-item:not(:disabled):hover { background: color-mix(in oklch, var(--theme-button-bg) 90%, transparent); }
                }
                @media (hover: none) {
                    .members-tag-edit { opacity: 1; }
                }
                .members-menu-item:not(:disabled):focus-visible { background: color-mix(in oklch, var(--theme-button-bg) 90%, transparent); }
            `}</style>
        </div>
    )
}

function NoMembersOverlay() {
    return <EmptyState>No members match these filters.</EmptyState>
}

/** Avatar and name; clicking opens the profile editor when the viewer may edit this member. */
function MemberCell({ data: m, context }: CellProps) {
    if (!m) return null
    const onEdit = context.actions().onEdit(m)
    const name = nameOf(m)
    const goesBy = goesByOf(m)
    return (
        <button
            type="button"
            onClick={onEdit}
            disabled={!onEdit}
            title={onEdit ? "Edit member" : undefined}
            className={`flex items-center gap-3 min-w-0 w-full text-left rounded-lg enabled:cursor-pointer ${focusRing}`}
        >
            <MemberAvatar name={name} picture={m.picture} />
            <span className="flex flex-col min-w-0">
                <span className="text-sm font-medium truncate theme-h1-color">{name}</span>
                {goesBy && <span className="text-xs truncate theme-subtext-color">{goesBy}</span>}
            </span>
        </button>
    )
}

function RoleCell({ data: m, context }: CellProps) {
    if (!m) return null
    const role = m.role ? context.actions().roleById.get(m.role) : undefined
    return (
        <span className="flex items-center gap-2 min-w-0">
            <span className="text-sm truncate theme-text">{roleTextOf(m, role)}</span>
            {role?.level === "lead" && <LeadBadge />}
        </span>
    )
}

function StatusCell({ data: m }: CellProps) {
    if (!m) return null
    const kiosk = kioskGrantOf(m)
    return (
        <span className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm theme-text">{STATUS_LABEL[statusOf(m)]}</span>
            {kiosk && <KioskBadge grant={kiosk} />}
        </span>
    )
}

function TagsCell({ data: m, context }: CellProps) {
    if (!m) return null
    const onEditTags = context.actions().onEditTags(m)
    return (
        <span className="flex items-center gap-1 min-w-0 w-full">
            <span className="flex items-center gap-1 min-w-0 overflow-hidden" title={m.tags.join(", ") || undefined}>
                {m.tags.map(t => (
                    <span key={t} className="text-xs px-2 py-0.5 rounded-full shrink-0" style={tagChip}>{t}</span>
                ))}
            </span>
            {onEditTags && (
                <button
                    type="button"
                    onClick={onEditTags}
                    title="Edit tags"
                    aria-label={`Edit tags for ${nameOf(m)}`}
                    className={`members-tag-edit shrink-0 rounded-lg p-0.5 theme-subtext-color opacity-0 focus:opacity-100 hover:opacity-70 transition-opacity ${focusRing}`}
                >
                    <Tag size={14} />
                </button>
            )}
        </span>
    )
}

/** The member's one moderation action, then the "…" menu with the rest. */
function ActionsCell({ data: m, context }: CellProps) {
    if (!m) return null
    const a = context.actions()
    const action = a.actionFor(m)
    const onEdit = a.onEdit(m)
    const onEditTags = a.onEditTags(m)
    const kioskBlocked = a.kioskBlocked(m)
    const kiosk = kioskGrantOf(m)
    const Icon = action.icon
    return (
        <span className="flex items-center gap-1">
            <button
                type="button"
                onClick={() => void action.run().catch(a.onError)}
                disabled={action.disabled}
                title={action.reason ?? action.label}
                aria-label={`${action.label} ${nameOf(m)}`}
                className={`members-action w-8 h-8 rounded-lg border border-transparent grid place-items-center theme-subtext-color cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${focusRing}`}
            >
                <Icon size={14} />
            </button>
            <RowMenu
                label={`More actions for ${nameOf(m)}`}
                items={[
                    { label: "Edit profile", icon: Pencil, onClick: onEdit, reason: onEdit ? undefined : "This member is outside your editing scope" },
                    { label: "Edit tags", icon: Tag, onClick: onEditTags, reason: onEditTags ? undefined : "You can't edit tags" },
                    { label: kiosk ? "Change kiosk access…" : "Grant kiosk access…", icon: ScanLine, onClick: kioskBlocked ? undefined : () => a.onKioskAccess(m), reason: kioskBlocked, divider: true },
                    ...(kiosk ? [{ label: "Revoke kiosk access", icon: X, onClick: kioskBlocked ? undefined : () => a.onRevokeKiosk(m), reason: kioskBlocked, danger: true }] : []),
                ]}
            />
        </span>
    )
}

/** Marks a member holding a live kiosk grant; the tooltip says when it ends. */
function KioskBadge({ grant }: { grant: "no_end" | Date }) {
    const text = `Kiosk access · ${kioskGrantLabel(grant)}`
    return (
        <span
            title={text}
            aria-label={text}
            className="inline-flex items-center gap-1 text-xs font-semibold px-1.5 py-0.5 rounded-full shrink-0"
            style={tagChip}
        >
            <ScanLine size={12} aria-hidden /> Kiosk
        </span>
    )
}

interface RowMenuItem {
    label: string
    icon: typeof Check
    /** Absent = disabled; `reason` becomes the tooltip. */
    onClick?: () => void
    reason?: string
    /** Draw a separator above this item. */
    divider?: boolean
    danger?: boolean
}

/**
 * Row "…" menu: an anchored menu (design-system/modals.md, z-40). Grid cells clip
 * what overflows them, so the menu renders on <body>, fixed beside its button,
 * opening upward when there isn't room below. Arrow keys move between items; Esc,
 * an outside click, or scrolling the roster closes it.
 */
function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
    const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null)
    const open = pos !== null
    const triggerRef = useRef<HTMLButtonElement>(null)
    const menuRef = useRef<HTMLDivElement>(null)

    const close = useCallback((refocus: boolean) => {
        setPos(null)
        if (refocus) triggerRef.current?.focus()
    }, [])

    useEffect(() => {
        if (!open) return
        const outside = (target: EventTarget | null) =>
            !menuRef.current?.contains(target as Node) && !triggerRef.current?.contains(target as Node)
        const onDown = (e: MouseEvent) => { if (outside(e.target)) close(false) }
        // The menu is fixed where the button was; once anything scrolls, it no longer lines up.
        const onScroll = (e: Event) => { if (!menuRef.current?.contains(e.target as Node)) close(false) }
        const onResize = () => close(false)
        document.addEventListener("mousedown", onDown)
        window.addEventListener("scroll", onScroll, true)
        window.addEventListener("resize", onResize)
        menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus()
        return () => {
            document.removeEventListener("mousedown", onDown)
            window.removeEventListener("scroll", onScroll, true)
            window.removeEventListener("resize", onResize)
        }
    }, [open, close])

    const toggle = () => {
        const trigger = triggerRef.current
        if (open || !trigger) { close(false); return }
        const rect = trigger.getBoundingClientRect()
        const right = window.innerWidth - rect.right
        const upward = window.innerHeight - rect.bottom < 44 * items.length + 24
        setPos(upward ? { bottom: window.innerHeight - rect.top + 6, right } : { top: rect.bottom + 6, right })
    }

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        e.stopPropagation()
        if (e.key === "Escape") { close(true); return }
        if (e.key === "Tab") { close(false); return }
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
        e.preventDefault()
        const enabled = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])]
        const i = enabled.indexOf(document.activeElement as HTMLButtonElement)
        enabled[(i + (e.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length]?.focus()
    }

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                onClick={toggle}
                aria-label={label}
                title="More actions"
                aria-haspopup="menu"
                aria-expanded={open}
                className={`members-action w-8 h-8 rounded-lg border border-transparent grid place-items-center theme-subtext-color cursor-pointer ${focusRing}`}
                style={open ? { borderColor: "var(--theme-border)", color: "var(--theme-h1-color)" } : undefined}
            >
                <MoreHorizontal size={16} />
            </button>
            {open && createPortal(
                <div
                    ref={menuRef}
                    role="menu"
                    aria-label={label}
                    onKeyDown={onKeyDown}
                    className="fixed z-40 w-60 rounded-xl border shadow-lg theme-border p-1 flex flex-col"
                    style={{ ...pos, background: "var(--theme-bg)" }}
                >
                    {items.map(item => {
                        const ItemIcon = item.icon
                        return (
                            <div key={item.label} className="flex flex-col">
                                {item.divider && <div className="my-1 border-t theme-border" role="separator" />}
                                <button
                                    type="button"
                                    role="menuitem"
                                    disabled={!item.onClick}
                                    title={item.onClick ? undefined : item.reason}
                                    onClick={() => { close(true); item.onClick?.() }}
                                    className={`members-menu-item ${menuRowClass} font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed`}
                                    style={{ color: item.danger ? "var(--theme-danger)" : "var(--theme-text)" }}
                                >
                                    <span className="flex items-center gap-3 min-w-0">
                                        <ItemIcon size={16} className="shrink-0" aria-hidden />
                                        <span className="truncate">{item.label}</span>
                                    </span>
                                </button>
                            </div>
                        )
                    })}
                </div>,
                document.body,
            )}
        </>
    )
}
