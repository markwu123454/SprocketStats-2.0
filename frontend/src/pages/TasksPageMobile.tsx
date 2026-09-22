import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from "react"
import { ChevronDown, MessageSquare, Plus, Trash2, X } from "lucide-react"
import { useOnboardedUser, type OnboardedUser } from "@/contexts/authContext"
import Dropdown from "@/components/ui/Dropdown"
import { BUCKET_OPTIONS, bucketLabel } from "@/lib/taskBuckets"
import {
    addContributor, addNote, createTask, deleteNote, fetchNotes, leaveTask, removeContributor, reviewTask, unreviewTask, updateTask,
    PRIORITY_LABEL, STATUS_LABEL,
    type CreateTaskInput, type Person, type Task, type TaskNote, type TaskPriority, type UpdateTaskInput,
} from "@/lib/tasksApi"
import {
    DANGER_RED, PRIORITY_COLOR, PRIORITY_ORDER, AVATAR_INK,
    tint, tintColor, avatarBg, initialOf, formatRelativeTime, rowDue, assigneeOptions, sortWithinArea,
    matchesFilter, type SettableStatus, type StatusFilter, type TaskFilter, type WhoFilter,
} from "@/lib/taskFormat"
import { useTaskBoard, type TaskBoard } from "@/lib/useTaskBoard"

// The mock's own ink color for text sitting on an accent-filled surface
// (Create task / Post / Claim / the FAB) -- see .design-sync/conventions.md
// and CONTRACT.md "Non-negotiables" for why this + DANGER_RED + AVATAR_* are
// the only literal colors allowed on this page.
const INK = "#12261f"

const DROPDOWN_TRIGGER_CLASS = "rounded-xl border px-3 h-11 py-0 text-sm font-semibold theme-bg theme-border theme-text"
const CONTRIBUTOR_DROPDOWN_TRIGGER_CLASS = "rounded-xl border px-3 h-11 py-0 text-xs font-semibold theme-bg theme-border theme-subtext-color"

/** Same idea as `taskFormat`'s `tint` (a `--theme-*` token blended with
 *  `color-mix`), but toward black instead of transparent -- the mock uses
 *  this for "recessed" surfaces (sheet panels, the status picker tray, the
 *  notes drawer) sitting a shade darker than the page background. Not part
 *  of the shared `taskFormat` surface since only this page's recessed
 *  panels need it; still fully token-based, so it doesn't count as a
 *  hardcoded color under the page's "no literals but DANGER_RED, AVATAR_*
 *  and the accent-fill ink" rule. */
function tintDark(token: string, pct: number): string {
    return `color-mix(in oklch, var(${token}) ${pct}%, black)`
}

type Scope = "all" | "unclaimed" | "review"
type ReviewTabKey = "review" | "done"

/**
 * Mobile task board. `AppShell` already renders the mobile header and the
 * 5-tab bottom bar (see CONTRACT.md "Design -> real app mapping"), so this
 * page is board content only: scope tiles, a subteam chip rail, filters, the
 * task list, and a FAB that opens the new-task sheet.
 *
 * All state/permission logic comes from `useTaskBoard()` + `taskFormat`,
 * shared verbatim with the desktop board so the two pages can't drift on
 * *behavior* -- only layout differs. Deliberate differences from the design
 * mock (`TaskBoardMobile.dc.html`), all because the web board's behavior is
 * the real spec (CONTRACT.md point 3):
 *
 *  - The status badge's 3-up picker and primary action button are disabled
 *    for a `done` task (the mock's picker only ever offers todo/doing/review
 *    anyway; a done task uses the dedicated "Reopen" primary button instead).
 *  - The card's inline status picker, contributors block and primary button
 *    all gate on the same permission rules `TaskRow`/`ContributorsSection`
 *    use on desktop (`canEditTask`, the finisher-can't-self-review 403, the
 *    unassigned/done contributor-add 400) -- the mock's prototype only knows
 *    `isPrivileged`.
 *  - Priority uses the shared `PRIORITY_COLOR` accents (desktop's palette)
 *    rather than the mock's theme-token-tier coloring, so priority reads the
 *    same on both boards.
 *  - The mock's card has no overflow ("...") control at all; CONTRACT.md
 *    requires one (Edit / Send back to To do / Delete), so it's added here
 *    as a small icon button next to the status badge, opening a bottom sheet
 *    in the same visual language as the New/Edit task sheets.
 */
export default function TasksPageMobile() {
    const user = useOnboardedUser()
    const board = useTaskBoard()
    const { tasks, people, loading, loadError, actionError, setActionError } = board

    const [scope, setScope] = useState<Scope>("all")
    const [reviewTab, setReviewTab] = useState<ReviewTabKey>("review")
    const [bucketFilter, setBucketFilter] = useState<string>("all")
    const [whoFilter, setWhoFilter] = useState<WhoFilter>("everyone")
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")

    // Only one status picker, one notes drawer and one "..." sheet open at a
    // time, board-wide -- mirrors the desktop board's single expandedId/
    // menuOpenId/statusMenuOpenId (CONTRACT.md "Task card").
    const [pickerOpenId, setPickerOpenId] = useState<string | null>(null)
    const [notesOpenId, setNotesOpenId] = useState<string | null>(null)
    const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
    const [newTaskOpen, setNewTaskOpen] = useState(false)
    const [editingTask, setEditingTask] = useState<Task | null>(null)

    const live = tasks.filter(t => t.status !== "done")
    const done = tasks.filter(t => t.status === "done")

    // Scope tile / review-tab counts read the whole board, unfiltered by
    // bucket/who/status -- an at-a-glance overview, matching the mock's own
    // unfiltered tile computation (CONTRACT.md "Layout, top to bottom" #2).
    const unclaimedLiveCount = live.filter(t => !t.assignee_id).length
    const reviewLiveCount = live.filter(t => t.status === "review").length

    const tiles: { key: Scope; label: string; count: number }[] = [
        { key: "all", label: "Tasks", count: live.length },
        { key: "unclaimed", label: "Unclaimed", count: unclaimedLiveCount },
        { key: "review", label: "Review & done", count: reviewLiveCount },
    ]

    const showReviewTabs = scope === "review"
    const reviewTabs: { key: ReviewTabKey; label: string; count: number }[] = [
        { key: "review", label: "Awaiting review", count: reviewLiveCount },
        { key: "done", label: "Completed", count: done.length },
    ]

    // Base pool per CONTRACT.md "Pool / scope rules": live tasks, except the
    // Review & done tile's Completed tab (or an explicit "done" status
    // filter) switches to the done pool instead.
    const basePool = (scope === "review" && reviewTab === "done") || statusFilter === "done" ? done : live

    // Subteam chip counts read `basePool` only -- *not* narrowed by the
    // Unclaimed scope or the Review tab's "Needs review" narrowing, matching
    // the design mock's own chip-count computation exactly (its `pool.filter
    // (...)`, evaluated before those two `tasks = tasks.filter(...)` lines).
    // Switching to a bucket while scoped to "Unclaimed" is meant to show
    // "how many total tasks does CAD have", not "how many of CAD's tasks are
    // currently unclaimed" -- that number is what the list below shows.
    const chips = [{ value: "all", label: "All tasks" }, ...BUCKET_OPTIONS].map(b => ({
        ...b,
        count: b.value === "all" ? basePool.length : basePool.filter(t => t.bucket === b.value).length,
    }))

    const visibleTasks = useMemo(() => {
        let list = basePool
        if (scope === "unclaimed") list = list.filter(t => !t.assignee_id)
        if (scope === "review" && reviewTab === "review") list = list.filter(t => t.status === "review")
        const filter: TaskFilter = { bucket: bucketFilter, status: statusFilter, who: whoFilter, quick: null }
        return list.filter(t => matchesFilter(t, filter, user.id, board.todayMs)).sort(sortWithinArea)
    }, [basePool, scope, reviewTab, bucketFilter, statusFilter, whoFilter, user.id, board.todayMs])

    const whoOptions = [
        { value: "everyone", label: "Everyone" },
        { value: "me", label: "My tasks" },
        { value: "unclaimed", label: "Unassigned" },
        ...people.map(p => ({ value: p.id, label: p.display_name })),
    ]
    const statusOptions = [
        { value: "all", label: "Any status" },
        { value: "todo", label: STATUS_LABEL.todo },
        { value: "doing", label: STATUS_LABEL.doing },
        { value: "review", label: STATUS_LABEL.review },
        { value: "done", label: STATUS_LABEL.done },
    ]

    const listLabel = scope === "unclaimed"
        ? "Unclaimed"
        : scope === "review"
            ? (reviewTab === "done" ? "Completed" : "Awaiting review")
            : (bucketFilter === "all" ? "All tasks" : bucketLabel(bucketFilter))
    const shownCount = `${visibleTasks.length} ${visibleTasks.length === 1 ? "task" : "tasks"}`

    // New-task sheet's subteam default: the active chip beats the viewer's
    // own subteam beats a plain "general" fallback (CONTRACT.md "New task
    // sheet").
    const defaultBucket = bucketFilter !== "all" ? bucketFilter : (board.mySubteam ?? "general")

    const menuTask = menuOpenId ? tasks.find(t => t.id === menuOpenId) ?? null : null

    if (loading) {
        return (
            <div style={{ padding: "24px 16px" }}>
                <p style={{ fontSize: 13, color: "var(--theme-subtext-color)" }}>Loading tasks…</p>
            </div>
        )
    }

    return (
        <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "16px 16px 0" }}>
                <h1 style={{ margin: 0, fontSize: 26, lineHeight: 1.15, fontWeight: 700, color: "var(--theme-h1-color)" }}>Task board</h1>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    {tiles.map(tile => {
                        const active = scope === tile.key
                        return (
                            <button key={tile.key} type="button" onClick={() => setScope(tile.key)} style={tileStyle(active)}>
                                <div style={tileCountStyle(active)}>{tile.count}</div>
                                <div style={tileLabelStyle(active)}>{tile.label}</div>
                            </button>
                        )
                    })}
                </div>

                {loadError && <div style={{ marginTop: 10 }}><ErrorBanner message={loadError} /></div>}
                {actionError && <div style={{ marginTop: 10 }}><ErrorBanner message={actionError} onDismiss={() => setActionError(null)} /></div>}
            </div>

            {/* Firefox honors scrollbarWidth inline; Chrome/Safari need the
                ::-webkit-scrollbar rule below, which can't be expressed as a
                React style object -- a scoped <style> tag (same pattern
                AppShell.tsx uses for its spin keyframes) keeps it self
                contained in this one file. */}
            <div className="tasks-mobile-chip-rail" style={{ display: "flex", gap: 8, overflowX: "auto", scrollbarWidth: "none", padding: "14px 16px 2px", scrollPaddingInline: 16, scrollSnapType: "x mandatory" }}>
                {chips.map(chip => {
                    const active = bucketFilter === chip.value
                    return (
                        <button key={chip.value} type="button" onClick={() => setBucketFilter(chip.value)} style={chipStyle(active)}>
                            <span>{chip.label}</span>
                            <span style={{ fontSize: 11.5, fontWeight: 700, opacity: 0.7 }}>{chip.count}</span>
                        </button>
                    )
                })}
            </div>
            <style>{".tasks-mobile-chip-rail::-webkit-scrollbar { display: none }"}</style>

            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px 4px" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <Dropdown value={whoFilter} onChange={v => setWhoFilter(v as WhoFilter)} options={whoOptions} triggerClassName={DROPDOWN_TRIGGER_CLASS} searchable label="Filter by person" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <Dropdown value={statusFilter} onChange={v => setStatusFilter(v as StatusFilter)} options={statusOptions} triggerClassName={DROPDOWN_TRIGGER_CLASS} label="Status" />
                </div>
            </div>

            {showReviewTabs && (
                <div style={{ display: "flex", gap: 4, margin: "12px 16px 0", padding: 4, borderRadius: 12, border: `1px solid ${tint("--theme-border", 70)}`, background: "var(--theme-button-bg)" }}>
                    {reviewTabs.map(tab => {
                        const active = reviewTab === tab.key
                        return (
                            <button key={tab.key} type="button" onClick={() => setReviewTab(tab.key)} style={reviewTabStyle(active)}>
                                {tab.label} · {tab.count}
                            </button>
                        )
                    })}
                </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 16px calc(132px + env(safe-area-inset-bottom))" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--theme-subtext-color)" }}>{listLabel}</div>
                    <div style={{ fontSize: 12, color: "var(--theme-subtext-color)" }}>{shownCount}</div>
                </div>

                {visibleTasks.map(task => (
                    <TaskCard
                        key={task.id}
                        task={task}
                        board={board}
                        user={user}
                        people={people}
                        todayMs={board.todayMs}
                        pickerOpen={pickerOpenId === task.id}
                        notesOpen={notesOpenId === task.id}
                        onTogglePicker={() => setPickerOpenId(id => (id === task.id ? null : task.id))}
                        onToggleNotes={() => setNotesOpenId(id => (id === task.id ? null : task.id))}
                        onToggleMenu={() => setMenuOpenId(id => (id === task.id ? null : task.id))}
                    />
                ))}

                {visibleTasks.length === 0 && (
                    <div style={{ padding: "28px 16px", textAlign: "center", borderRadius: 16, border: `1px dashed ${tint("--theme-border", 80)}`, color: "var(--theme-subtext-color)", fontSize: 13 }}>
                        Nothing here yet. Try a different subteam or filter.
                    </div>
                )}
            </div>

            <button type="button" onClick={() => setNewTaskOpen(true)} aria-label="New task" style={fabStyle}>
                <Plus size={26} />
            </button>

            {newTaskOpen && (
                <TaskFormSheet mode="create" board={board} people={people} defaultBucket={defaultBucket} onClose={() => setNewTaskOpen(false)} />
            )}
            {editingTask && (
                <TaskFormSheet mode="edit" task={editingTask} board={board} people={people} defaultBucket={editingTask.bucket} onClose={() => setEditingTask(null)} />
            )}
            {menuTask && (
                <TaskActionSheet task={menuTask} board={board} onClose={() => setMenuOpenId(null)} onEdit={() => setEditingTask(menuTask)} />
            )}
        </div>
    )
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
    return (
        <div
            style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                fontSize: 13, padding: "8px 12px", borderRadius: 10,
                border: `1px solid ${tint("--theme-border", 70)}`, background: tint("--theme-border", 40),
                color: "var(--theme-subtext-color)",
            }}
        >
            <span>{message}</span>
            {onDismiss && (
                <button type="button" onClick={onDismiss} aria-label="Dismiss" style={{ flex: "none", border: "none", background: "transparent", color: "var(--theme-subtext-color)", cursor: "pointer", padding: 4 }}>
                    <X size={14} />
                </button>
            )}
        </div>
    )
}

function tileStyle(active: boolean): CSSProperties {
    return {
        flex: 1, minWidth: 0, textAlign: "left", padding: "8px 10px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
        border: active ? "1px solid var(--theme-text-contrast)" : `1px solid ${tint("--theme-border", 70)}`,
        background: active ? tint("--theme-text-contrast", 14) : "var(--theme-button-bg)",
    }
}
function tileCountStyle(active: boolean): CSSProperties {
    return { fontSize: 18, fontWeight: 700, color: active ? "var(--theme-text-contrast)" : "var(--theme-h1-color)" }
}
function tileLabelStyle(active: boolean): CSSProperties {
    return { fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: active ? "var(--theme-text-contrast)" : "var(--theme-subtext-color)" }
}
function chipStyle(active: boolean): CSSProperties {
    return {
        flex: "none", scrollSnapAlign: "start", display: "flex", alignItems: "center", gap: 8, minHeight: 44,
        padding: "0 16px", borderRadius: 999, cursor: "pointer", fontSize: 13.5, fontWeight: 650, whiteSpace: "nowrap", fontFamily: "inherit",
        border: active ? "1px solid var(--theme-text-contrast)" : `1px solid ${tint("--theme-border", 75)}`,
        background: active ? tint("--theme-text-contrast", 16) : "var(--theme-button-bg)",
        color: active ? "var(--theme-text-contrast)" : "var(--theme-text)",
    }
}
function reviewTabStyle(active: boolean): CSSProperties {
    return {
        flex: 1, minWidth: 0, minHeight: 38, borderRadius: 10, cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, border: "none",
        background: active ? tint("--theme-text-contrast", 18) : "transparent",
        color: active ? "var(--theme-text-contrast)" : "var(--theme-subtext-color)",
    }
}

const fabStyle: CSSProperties = {
    position: "fixed", zIndex: 30, right: "max(20px, calc(50vw - 195px))",
    // AppShell's own mobile tab bar (not this page's -- that one's dropped
    // per CONTRACT.md's mapping table) is up to ~96px tall plus its own
    // safe-area padding; the mock's "88px" assumed a shorter fake bar, so
    // this is bumped to clear the real one with room to spare.
    bottom: "calc(112px + env(safe-area-inset-bottom))",
    width: 58, height: 58, borderRadius: 999, border: "none", display: "flex", alignItems: "center", justifyContent: "center",
    background: "var(--theme-text-contrast)", color: INK, boxShadow: "0 8px 24px rgba(0,0,0,.45)", cursor: "pointer",
}

// ── Task card ────────────────────────────────────────────────────────────

interface TaskCardProps {
    task: Task
    board: TaskBoard
    user: OnboardedUser
    people: Person[]
    todayMs: number
    pickerOpen: boolean
    notesOpen: boolean
    onTogglePicker: () => void
    onToggleNotes: () => void
    onToggleMenu: () => void
}

const PICKER_CHOICES: SettableStatus[] = ["todo", "doing", "review"]

function TaskCard({ task, board, user, people, todayMs, pickerOpen, notesOpen, onTogglePicker, onToggleNotes, onToggleMenu }: TaskCardProps) {
    const canEdit = board.canEditTask(task)
    const done = task.status === "done"
    const review = task.status === "review"
    const due = rowDue(task, todayMs)
    const unreadCount = board.unread(task)
    const isFinisher = task.finished_by === user.id
    const isAssignee = task.assignee_id === user.id
    const isContributor = task.contributors.some(c => c.id === user.id)

    // Adding a contributor 400s when the task is unassigned or done (see
    // tasksApi's `addContributor` doc comment) -- hide the whole block
    // rather than ship controls guaranteed to fail, the same rule
    // `ContributorsSection` uses on desktop.
    const contributorsAllowed = !!task.assignee_id && !done

    const excludeIds = new Set([task.assignee_id, ...task.contributors.map(c => c.id)])
    const addOtherOptions = people.filter(p => !excludeIds.has(p.id)).map(p => ({ value: p.id, label: p.display_name }))

    // Status can only be changed from the card for todo/doing/review; a done
    // task reaches its status through "Reopen" (unreviewTask) instead, same
    // as the desktop row disabling its badge when `done`.
    const canTogglePicker = canEdit && !done

    function pick(status: SettableStatus) {
        onTogglePicker()
        void board.runAction(() => updateTask(task.id, { status }))
    }

    let primary: ReactNode = null
    if (!task.assignee_id) {
        primary = <button type="button" onClick={() => void board.handleClaim(task.id)} style={primaryAccentStyle}>Claim task</button>
    } else if (review) {
        // The backend 403s the finisher marking their own task reviewed
        // unless they also hold tasks.assign -- CONTRACT.md "Task card".
        if (!isFinisher || board.canAssign) {
            primary = <button type="button" onClick={() => void board.runAction(() => reviewTask(task.id))} style={primaryNeutralStyle}>Mark reviewed</button>
        } else {
            primary = (
                <span style={needsEyesStyle}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--theme-text-contrast)" }} />
                    <span>Needs a second pair of eyes</span>
                </span>
            )
        }
    } else if (done) {
        if (canEdit) primary = <button type="button" onClick={() => void board.runAction(() => unreviewTask(task.id))} style={primaryNeutralStyle}>Reopen</button>
    } else if (canEdit) {
        primary = <button type="button" onClick={() => void board.runAction(() => updateTask(task.id, { status: "review" }))} style={primaryNeutralStyle}>Submit for review</button>
    }

    return (
        <div style={cardStyle}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <span style={titleStyle}>{task.title}</span>
                {canTogglePicker ? (
                    <button type="button" onClick={onTogglePicker} aria-label="Change status" style={statusToggleBtnStyle}>
                        <span style={badgeStyle(task.status)}>
                            {STATUS_LABEL[task.status]}
                            <ChevronDown size={10} />
                        </span>
                    </button>
                ) : (
                    <span style={{ ...badgeStyle(task.status), flex: "none" }}>{STATUS_LABEL[task.status]}</span>
                )}
                {canEdit && (
                    <button type="button" onClick={onToggleMenu} aria-label="More actions" style={moreBtnStyle}>⋯</button>
                )}
            </div>

            {pickerOpen && canTogglePicker && (
                <div style={pickerGridStyle}>
                    {PICKER_CHOICES.map(choice => (
                        <button key={choice} type="button" onClick={() => pick(choice)} style={pickerOptionStyle(choice === task.status)}>
                            {STATUS_LABEL[choice]}
                        </button>
                    ))}
                </div>
            )}

            <div style={metaRowStyle}>
                <button type="button" onClick={onToggleNotes} aria-label="Notes" style={notesToggleBtnStyle}>
                    <span style={notesChipStyle(notesOpen, unreadCount > 0, task.note_count > 0)}>
                        <MessageSquare size={14} />
                        {task.note_count > 0 && <span>{task.note_count}</span>}
                    </span>
                </button>
                <span style={priorityPillStyle(task.priority)}>{PRIORITY_LABEL[task.priority]} priority</span>
                <span style={bucketPillStyle}>{bucketLabel(task.bucket)} · {task.area}</span>
                <span style={{ color: due.color }}>{due.text}</span>
                <span>{ownerLine(task)}</span>
            </div>

            {contributorsAllowed && (
                <div style={contributorsWrapStyle}>
                    {task.contributors.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                            <span style={withLabelStyle}>With</span>
                            {task.contributors.map(c => {
                                const removable = board.canAssign || c.id === user.id
                                return (
                                    <span key={c.id} style={contributorPillStyle(removable)}>
                                        {c.display_name}
                                        {removable && (
                                            <button
                                                type="button"
                                                aria-label={`Remove ${c.display_name}`}
                                                onClick={() => void board.runAction(() => (board.canAssign ? removeContributor(task.id, c.id) : leaveTask(task.id)))}
                                                style={removeBtnStyle}
                                            >
                                                ✕
                                            </button>
                                        )}
                                    </span>
                                )
                            })}
                        </div>
                    )}
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {/* One control, never both -- the same either/or the web
                            board draws ("+ Add" for the authority set, "+ Join"
                            for everyone else). A lead picking anyone from the
                            dropdown can already add themselves through it, so a
                            second, redundant Join button would just be clutter. */}
                        {board.canAssign ? addOtherOptions.length > 0 && (
                            <div style={addDropdownWrapStyle}>
                                <Dropdown
                                    value=""
                                    onChange={v => { if (v) void board.runAction(() => addContributor(task.id, v)) }}
                                    options={addOtherOptions}
                                    placeholder="+ Add contributor"
                                    triggerClassName={CONTRIBUTOR_DROPDOWN_TRIGGER_CLASS}
                                    searchable
                                    label="Add contributor"
                                />
                            </div>
                        ) : !isAssignee && !isContributor && (
                            <button type="button" onClick={() => void board.runAction(() => addContributor(task.id))} style={joinBtnStyle}>
                                + Join as {user.given_name}
                            </button>
                        )}
                    </div>
                </div>
            )}

            {primary}

            {notesOpen && <NotesDrawer task={task} board={board} user={user} />}
        </div>
    )
}

/** Owner line for the meta row: a done task credits whoever finished it (plus
 *  any contributors who helped), otherwise it's just the assignee -- or
 *  "Unassigned" (CONTRACT.md "Task card"). */
function ownerLine(task: Task): string {
    if (task.status === "done") {
        const finisher = task.finished_by_name ?? "someone"
        const withOthers = task.contributors.length > 0 ? ` with ${task.contributors.map(c => c.display_name).join(", ")}` : ""
        return `Finished by ${finisher}${withOthers}`
    }
    return task.assignee_name ?? "Unassigned"
}

const cardStyle: CSSProperties = {
    padding: 14, borderRadius: 16, border: `1px solid ${tint("--theme-border", 75)}`, background: "var(--theme-button-bg)",
    display: "flex", flexDirection: "column", gap: 10,
}
const titleStyle: CSSProperties = {
    flex: "1 1 auto", minWidth: 0, textAlign: "left", minHeight: 44, display: "flex", alignItems: "center",
    fontSize: 16, fontWeight: 650, lineHeight: 1.3, color: "var(--theme-h1-color)",
}
const statusToggleBtnStyle: CSSProperties = {
    flex: "none", display: "flex", alignItems: "center", minHeight: 44, margin: "-10px 0", padding: 0,
    border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit",
}
const moreBtnStyle: CSSProperties = {
    flex: "none", width: 44, height: 44, margin: "-10px -6px -10px 0", display: "flex", alignItems: "center", justifyContent: "center",
    border: "none", background: "transparent", color: "var(--theme-subtext-color)", fontSize: 18, cursor: "pointer",
}
function badgeStyle(status: Task["status"]): CSSProperties {
    const accent = status === "todo"
    const isReview = status === "review"
    const c = accent ? "var(--theme-text-contrast)" : isReview ? "var(--theme-h1-color)" : "var(--theme-subtext-color)"
    return {
        display: "flex", alignItems: "center", gap: 4, padding: "4px 9px", borderRadius: 999,
        fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", whiteSpace: "nowrap",
        color: c, border: `1px solid ${tintColor(c, 45)}`, background: tintColor(c, 10),
    }
}
const pickerGridStyle: CSSProperties = {
    display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 4, padding: 4, borderRadius: 12,
    border: `1px solid ${tint("--theme-border", 70)}`, background: tintDark("--theme-bg", 70),
}
function pickerOptionStyle(selected: boolean): CSSProperties {
    return {
        minWidth: 0, minHeight: 44, padding: "0 4px", borderRadius: 9, border: "none", cursor: "pointer", fontFamily: "inherit",
        fontSize: 11.5, fontWeight: 700, lineHeight: 1.15,
        background: selected ? tint("--theme-text-contrast", 18) : "transparent",
        color: selected ? "var(--theme-text-contrast)" : "var(--theme-subtext-color)",
    }
}
const metaRowStyle: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 10px", fontSize: 12, color: "var(--theme-subtext-color)" }
const notesToggleBtnStyle: CSSProperties = {
    display: "flex", alignItems: "center", minHeight: 44, margin: "-10px 0", padding: 0,
    border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit",
}
function notesChipStyle(open: boolean, unread: boolean, hasNotes: boolean): CSSProperties {
    const highlighted = open || unread
    return {
        display: "flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit",
        fontSize: 12, fontWeight: 650,
        border: highlighted ? "1px solid var(--theme-text-contrast)" : `1px solid ${tint("--theme-border", 80)}`,
        background: highlighted ? tint("--theme-text-contrast", 12) : "transparent",
        // Unread color rule matches the desktop row's `noteColor` exactly
        // (CONTRACT.md "Task card": "same rule as web").
        color: unread ? "var(--theme-text-contrast)" : hasNotes ? "var(--theme-text)" : "var(--theme-subtext-color)",
    }
}
function priorityPillStyle(priority: TaskPriority): CSSProperties {
    const c = PRIORITY_COLOR[priority]
    return {
        display: "flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 999, whiteSpace: "nowrap", fontWeight: 700,
        color: c, border: `1px solid ${tintColor(c, 45)}`, background: tintColor(c, 10),
    }
}
const bucketPillStyle: CSSProperties = { padding: "3px 8px", borderRadius: 999, border: `1px solid ${tint("--theme-border", 80)}`, whiteSpace: "nowrap" }
const contributorsWrapStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 8, paddingTop: 2, borderTop: `1px solid ${tint("--theme-border", 45)}` }
const withLabelStyle: CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--theme-subtext-color)" }
function contributorPillStyle(removable: boolean): CSSProperties {
    return {
        display: "flex", alignItems: "center", gap: 4, padding: removable ? "4px 18px 4px 10px" : "4px 10px", borderRadius: 999,
        background: tint("--theme-border", 55), color: "var(--theme-text)", fontSize: 12, fontWeight: 600,
    }
}
const removeBtnStyle: CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "center", width: 44, height: 44, margin: "-12px -16px -12px -8px",
    border: "none", background: "transparent", color: "var(--theme-subtext-color)", fontSize: 13, lineHeight: 1, cursor: "pointer", padding: 0,
}
const addDropdownWrapStyle: CSSProperties = { width: "100%", display: "flex", flexDirection: "column", justifyContent: "center", minHeight: 44 }
const joinBtnStyle: CSSProperties = {
    width: "100%", minHeight: 44, borderRadius: 12, border: `1px dashed ${tint("--theme-text-contrast", 60)}`, background: "transparent",
    color: "var(--theme-text-contrast)", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
}
const primaryAccentStyle: CSSProperties = {
    width: "100%", minHeight: 44, borderRadius: 12, border: "none", cursor: "pointer", fontSize: 13.5, fontWeight: 700,
    background: "var(--theme-text-contrast)", color: INK,
}
const primaryNeutralStyle: CSSProperties = {
    width: "100%", minHeight: 44, borderRadius: 12, border: "none", cursor: "pointer", fontSize: 13.5, fontWeight: 700,
    background: tint("--theme-border", 55), color: "var(--theme-h1-color)",
}
const needsEyesStyle: CSSProperties = {
    width: "100%", minHeight: 44, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
    fontSize: 12.5, fontWeight: 600, border: `1px dashed ${tint("--theme-text-contrast", 55)}`, color: "var(--theme-text-contrast)",
}

// ── Notes drawer ─────────────────────────────────────────────────────────

function NotesDrawer({ task, board, user }: { task: Task; board: TaskBoard; user: OnboardedUser }) {
    const [notes, setNotes] = useState<TaskNote[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [draft, setDraft] = useState("")
    const [posting, setPosting] = useState(false)

    useEffect(() => {
        let cancelled = false
        setNotes(null)
        fetchNotes(task.id)
            .then(data => { if (!cancelled) setNotes(data) })
            .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load notes") })
        return () => { cancelled = true }
    }, [task.id])

    // This drawer only ever mounts while it's the one open notes drawer
    // board-wide, so its own mount/unmount *is* "opened"/"closed" --
    // CONTRACT.md: "Call markNotesRead(task) on open and cancelMarkNotesRead
    // () on close."
    useEffect(() => {
        board.markNotesRead(task)
        return () => board.cancelMarkNotesRead()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [task.id])

    async function handlePost() {
        const body = draft.trim()
        if (!body || posting) return
        setPosting(true)
        setError(null)
        try {
            const note = await addNote(task.id, body)
            setNotes(prev => [...(prev ?? []), note])
            setDraft("")
            board.bumpNoteCount(task.id, 1)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to post note")
        } finally {
            setPosting(false)
        }
    }

    async function handleDelete(note: TaskNote) {
        setError(null)
        try {
            await deleteNote(task.id, note.id)
            setNotes(prev => (prev ?? []).filter(n => n.id !== note.id))
            board.bumpNoteCount(task.id, -1)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to delete note")
        }
    }

    const canPost = draft.trim().length > 0 && !posting

    return (
        <div style={notesDrawerStyle}>
            {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

            {notes === null ? (
                <p style={{ fontSize: 13, color: "var(--theme-subtext-color)", margin: 0 }}>Loading notes…</p>
            ) : notes.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--theme-subtext-color)", margin: 0 }}>No notes yet — leave context for whoever picks this up.</p>
            ) : (
                notes.map(note => {
                    const canDelete = note.author_id === user.id || board.canAssign
                    return (
                        <div key={note.id} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                            <span style={noteAvatarStyle(note.author_name)}>{initialOf(note.author_name)}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 11.5, color: "var(--theme-subtext-color)" }}>
                                    <span style={{ fontWeight: 700, color: "var(--theme-text)" }}>{note.author_name ?? "Someone"}</span> · {formatRelativeTime(note.created_at)}
                                </div>
                                <div style={{ fontSize: 14, lineHeight: 1.4, color: "var(--theme-text)", overflowWrap: "anywhere" }}>{note.body}</div>
                            </div>
                            {canDelete && (
                                <button type="button" aria-label="Delete note" onClick={() => void handleDelete(note)} style={deleteNoteBtnStyle}>
                                    <Trash2 size={14} />
                                </button>
                            )}
                        </div>
                    )
                })
            )}

            <textarea
                placeholder="Add a note…"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                rows={2}
                maxLength={2000}
                style={notesTextareaStyle}
            />
            <button type="button" onClick={() => void handlePost()} disabled={!canPost} style={{ ...postBtnStyle, opacity: canPost ? 1 : 0.5, cursor: canPost ? "pointer" : "default" }}>
                {posting ? "Posting…" : "Post"}
            </button>
        </div>
    )
}

const notesDrawerStyle: CSSProperties = {
    display: "flex", flexDirection: "column", gap: 10, padding: 12, borderRadius: 14,
    background: tintDark("--theme-bg", 70), border: `1px solid ${tint("--theme-border", 50)}`,
}
function noteAvatarStyle(name: string | null): CSSProperties {
    return {
        width: 22, height: 22, flex: "none", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 10, fontWeight: 700, color: AVATAR_INK, background: avatarBg(name ?? "?"),
    }
}
const deleteNoteBtnStyle: CSSProperties = {
    flex: "none", display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 8,
    border: "none", background: "transparent", color: "var(--theme-subtext-color)", cursor: "pointer",
}
const notesTextareaStyle: CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 12, border: `1px solid ${tint("--theme-border", 75)}`,
    background: "var(--theme-button-bg)", color: "var(--theme-text)", fontSize: 14, fontFamily: "inherit", resize: "none", outline: "none",
}
const postBtnStyle: CSSProperties = {
    alignSelf: "flex-end", minHeight: 38, padding: "0 18px", borderRadius: 10, border: "none",
    background: "var(--theme-text-contrast)", color: INK, fontSize: 13, fontWeight: 700,
}

// ── Bottom sheets ────────────────────────────────────────────────────────

function BottomSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
    return (
        <div style={sheetOverlayStyle}>
            <div onClick={onClose} style={{ position: "absolute", inset: 0 }} />
            <div style={sheetPanelStyle} onClick={e => e.stopPropagation()}>
                <div style={sheetHandleStyle} />
                {children}
            </div>
        </div>
    )
}

const sheetOverlayStyle: CSSProperties = { position: "fixed", inset: 0, zIndex: 40, display: "flex", alignItems: "flex-end", justifyContent: "center", background: "rgba(0,0,0,.55)" }
const sheetPanelStyle: CSSProperties = {
    position: "relative", width: "100%", maxWidth: 430, borderRadius: "22px 22px 0 0", borderTop: `1px solid ${tint("--theme-border", 80)}`,
    background: tintDark("--theme-bg", 96), padding: "10px 16px calc(18px + env(safe-area-inset-bottom))",
    display: "flex", flexDirection: "column", gap: 14, boxShadow: "0 -14px 40px rgba(0,0,0,.45)",
}
const sheetHandleStyle: CSSProperties = { width: 40, height: 4, borderRadius: 999, background: tint("--theme-subtext-color", 50), alignSelf: "center" }
const sheetHeaderRowStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }
const sheetTitleStyle: CSSProperties = { margin: 0, fontSize: 19, fontWeight: 700, color: "var(--theme-h1-color)" }
const sheetCloseBtnStyle: CSSProperties = {
    flex: "none", width: 36, height: 36, borderRadius: 999, border: `1px solid ${tint("--theme-border", 80)}`, background: "transparent",
    color: "var(--theme-subtext-color)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
}

function TaskActionSheet({ task, board, onClose, onEdit }: { task: Task; board: TaskBoard; onClose: () => void; onEdit: () => void }) {
    const canSendBack = task.status === "doing" || task.status === "review"
    return (
        <BottomSheet onClose={onClose}>
            <div style={sheetHeaderRowStyle}>
                <h2 style={sheetTitleStyle}>{task.title}</h2>
                <button type="button" onClick={onClose} aria-label="Close" style={sheetCloseBtnStyle}><X size={16} /></button>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
                <SheetActionButton label="Edit task" onClick={() => { onEdit(); onClose() }} />
                {canSendBack && (
                    <SheetActionButton label="Send back to To do" onClick={() => { onClose(); void board.runAction(() => updateTask(task.id, { status: "todo" })) }} />
                )}
                <SheetActionButton label="Delete task" danger onClick={() => { onClose(); void board.handleDelete(task) }} />
            </div>
        </BottomSheet>
    )
}

function SheetActionButton({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
    return (
        <button
            type="button"
            onClick={onClick}
            style={{
                width: "100%", minHeight: 48, textAlign: "left", padding: "0 4px", border: "none", background: "transparent",
                fontFamily: "inherit", fontSize: 15, fontWeight: 600, cursor: "pointer",
                color: danger ? DANGER_RED : "var(--theme-text)",
                borderTop: danger ? `1px solid ${tint("--theme-border", 40)}` : "none",
                marginTop: danger ? 8 : 0, paddingTop: danger ? 14 : 0,
            }}
        >
            {label}
        </button>
    )
}

// ── New / Edit task sheet ────────────────────────────────────────────────

interface TaskFormSheetProps {
    mode: "create" | "edit"
    task?: Task
    board: TaskBoard
    people: Person[]
    defaultBucket: string
    onClose: () => void
}

function TaskFormSheet({ mode, task, board, people, defaultBucket, onClose }: TaskFormSheetProps) {
    const [title, setTitle] = useState(task?.title ?? "")
    const [bucket, setBucket] = useState(task?.bucket ?? defaultBucket)
    const [area, setArea] = useState(task?.area ?? "")
    const [dueDate, setDueDate] = useState(task?.due_date ?? "")
    const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? "med")
    const [assigneeId, setAssigneeId] = useState(task?.assignee_id ?? "")
    // "Claim it for myself" defaults on (mock's own default) -- a
    // non-privileged member creating a task is almost always creating it for
    // themselves; leaving it in the unclaimed pool is the exception.
    const [claimSelf, setClaimSelf] = useState(true)
    const [submitting, setSubmitting] = useState(false)

    const canSubmit = title.trim().length > 0 && !submitting

    async function handleSubmit(e: FormEvent) {
        e.preventDefault()
        if (!canSubmit) return
        setSubmitting(true)
        try {
            if (mode === "create") {
                const input: CreateTaskInput = {
                    title: title.trim(), bucket, area: area.trim() || undefined, priority, due_date: dueDate || null,
                }
                if (board.canAssign && assigneeId) input.assignee_id = assigneeId
                const created = await createTask(input)
                board.applyTask(created)
                onClose()
                // handleClaim (rather than a bare claimTask call) so a claim
                // collision on a just-created task still gets the same 409
                // handling + silent refresh every other claim path gets.
                if (!board.canAssign && claimSelf) void board.handleClaim(created.id)
            } else if (task) {
                const patch: UpdateTaskInput = {
                    title: title.trim(), area: area.trim() || undefined, bucket, priority, due_date: dueDate || null,
                }
                // Mirrors EditTaskModal: only a privileged editor may move
                // the assignment through this form.
                if (board.canAssign) patch.assignee_id = assigneeId || null
                board.applyTask(await updateTask(task.id, patch))
                onClose()
            }
        } catch (err) {
            board.setActionError(err instanceof Error ? err.message : `Failed to ${mode === "create" ? "create" : "save"} task`)
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <BottomSheet onClose={onClose}>
            <div style={sheetHeaderRowStyle}>
                <h2 style={sheetTitleStyle}>{mode === "create" ? "New task" : "Edit task"}</h2>
                <button type="button" onClick={onClose} aria-label="Close" style={sheetCloseBtnStyle}><X size={16} /></button>
            </div>
            <form onSubmit={e => void handleSubmit(e)} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <Field label="Task">
                    <input value={title} onChange={e => setTitle(e.target.value)} placeholder="What needs doing?" autoFocus style={sheetInputStyle} />
                </Field>

                <div style={{ display: "flex", gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <Field label="Subteam">
                            <Dropdown value={bucket} onChange={setBucket} options={BUCKET_OPTIONS} triggerClassName={DROPDOWN_TRIGGER_CLASS} label="Subteam" />
                        </Field>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <Field label="Area">
                            <input value={area} onChange={e => setArea(e.target.value)} placeholder="e.g. Wiring harness" style={sheetInputStyle} />
                        </Field>
                    </div>
                </div>

                <Field label="Due date">
                    <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={sheetInputStyle} />
                </Field>

                <Field label="Priority">
                    <div style={{ display: "flex", gap: 6 }}>
                        {PRIORITY_ORDER.map(p => (
                            <button key={p} type="button" onClick={() => setPriority(p)} style={prioritySegStyle(p === priority)}>
                                {PRIORITY_LABEL[p]}
                            </button>
                        ))}
                    </div>
                </Field>

                {board.canAssign && (
                    <Field label="Assign to">
                        <Dropdown value={assigneeId} onChange={setAssigneeId} options={assigneeOptions(people)} triggerClassName={DROPDOWN_TRIGGER_CLASS} searchable label="Assign to" />
                    </Field>
                )}

                {mode === "create" && !board.canAssign && (
                    <div style={claimToggleRowStyle}>
                        <div>
                            <div style={{ fontSize: 14, fontWeight: 650, color: "var(--theme-h1-color)" }}>Claim it for myself</div>
                            <div style={{ fontSize: 12, color: "var(--theme-subtext-color)" }}>Off leaves it in the unclaimed pool</div>
                        </div>
                        <button type="button" onClick={() => setClaimSelf(v => !v)} style={claimToggleTrackStyle(claimSelf)}>
                            <span style={claimToggleKnobStyle(claimSelf)} />
                        </button>
                    </div>
                )}

                <button type="submit" disabled={!canSubmit} style={{ ...sheetSubmitStyle, opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? "pointer" : "default" }}>
                    {submitting ? "Saving…" : mode === "create" ? "Create task" : "Save changes"}
                </button>
            </form>
        </BottomSheet>
    )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--theme-subtext-color)" }}>{label}</span>
            {children}
        </div>
    )
}

const sheetInputStyle: CSSProperties = {
    width: "100%", boxSizing: "border-box", minHeight: 46, padding: "0 14px", borderRadius: 12, border: `1px solid ${tint("--theme-border", 80)}`,
    background: "var(--theme-button-bg)", color: "var(--theme-text)", fontSize: 15, fontFamily: "inherit", outline: "none",
}
function prioritySegStyle(selected: boolean): CSSProperties {
    return {
        flex: 1, minHeight: 44, borderRadius: 12, cursor: "pointer", fontFamily: "inherit", fontSize: 13.5, fontWeight: 700,
        border: selected ? "1px solid var(--theme-text-contrast)" : `1px solid ${tint("--theme-border", 75)}`,
        background: selected ? tint("--theme-text-contrast", 16) : "var(--theme-button-bg)",
        color: selected ? "var(--theme-text-contrast)" : "var(--theme-text)",
    }
}
const claimToggleRowStyle: CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 14px", borderRadius: 14,
    border: `1px solid ${tint("--theme-border", 75)}`, background: "var(--theme-button-bg)",
}
function claimToggleTrackStyle(on: boolean): CSSProperties {
    return {
        flex: "none", width: 52, height: 30, borderRadius: 999, border: `1px solid ${tint("--theme-border", 80)}`, cursor: "pointer",
        display: "flex", alignItems: "center", padding: 3, justifyContent: on ? "flex-end" : "flex-start",
        background: on ? tint("--theme-text-contrast", 30) : "var(--theme-button-bg)",
    }
}
function claimToggleKnobStyle(on: boolean): CSSProperties {
    return { width: 22, height: 22, borderRadius: 999, background: on ? "var(--theme-text-contrast)" : "var(--theme-subtext-color)" }
}
const sheetSubmitStyle: CSSProperties = {
    width: "100%", minHeight: 50, borderRadius: 14, border: "none", background: "var(--theme-text-contrast)", color: INK, fontSize: 15, fontWeight: 750,
}
