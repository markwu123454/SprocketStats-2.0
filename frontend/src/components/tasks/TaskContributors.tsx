import { useState } from "react"
import Dropdown from "@/components/ui/Dropdown"
import type { Person, Task } from "@/lib/tasksApi"
import { focusRing, typeH2 } from "@/lib/uiClasses"

const detailLabelClass = `${typeH2} theme-subtext-color`

export interface ContributorsSectionProps {
    task: Task
    canAssign: boolean
    readOnly: boolean
    currentUserId: string
    people: Person[]
    dropdownTriggerClassName: string
    onAddSelf: () => void
    onAddOther: (personId: string) => void
    onRemoveContributor: (personId: string) => void
    onLeave: () => void
}

/** Its own component (rather than inline in TaskRow) so `addingContributor`
 *  resets every time the row's detail panel mounts, instead of surviving a
 *  collapse/re-expand as a stale "picker open" flag. */
export default function ContributorsSection({ task, canAssign, readOnly, currentUserId, people, dropdownTriggerClassName, onAddSelf, onAddOther, onRemoveContributor, onLeave }: ContributorsSectionProps) {
    const [addingContributor, setAddingContributor] = useState(false)

    const isAssignee = task.assignee_id === currentUserId
    const isContributor = task.contributors.some(c => c.id === currentUserId)
    const excludeIds = new Set([task.assignee_id, ...task.contributors.map(c => c.id)])
    const addOtherOptions = people.filter(p => !excludeIds.has(p.id)).map(p => ({ value: p.id, label: p.display_name }))

    // Adding a contributor 400s when the task is unassigned or done (see
    // SPEC "Permissions") -- hide the affordance rather than ship a button
    // that's guaranteed to fail.
    const contributorsAllowed = !readOnly && !!task.assignee_id && task.status !== "done"
    const showAddContributor = contributorsAllowed && (canAssign ? addOtherOptions.length > 0 : (!isAssignee && !isContributor))

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <span className={detailLabelClass}>Helping</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                {task.contributors.map(c => {
                    const removable = !readOnly && (canAssign || c.id === currentUserId)
                    return (
                        <span
                            key={c.id}
                            style={{
                                display: "flex", alignItems: "center", gap: 6, height: 28,
                                padding: removable ? "0 8px 0 12px" : "0 12px", borderRadius: 999,
                                border: "1px solid var(--theme-border)", color: "var(--theme-text)",
                            }}
                            className="text-xs"
                        >
                            <span>{c.display_name}</span>
                            {removable && (
                                <button
                                    type="button"
                                    onClick={e => { e.stopPropagation(); if (canAssign) onRemoveContributor(c.id); else onLeave() }}
                                    aria-label={`Remove ${c.display_name}`}
                                    className={`hover:text-(--theme-danger) text-xs theme-subtext-color ${focusRing}`}
                                    style={{ font: "inherit", border: "none", background: "transparent", padding: 0, cursor: "pointer" }}
                                >
                                    ✕
                                </button>
                            )}
                        </span>
                    )
                })}
                {showAddContributor && (
                    addingContributor ? (
                        /* `defaultOpen`: this picker only exists because the
                           user just clicked "+ Add", so it opens straight into
                           the roster instead of making them click it a second
                           time. Dismissing it without choosing anyone puts the
                           "+ Add" pill back, rather than stranding a closed
                           picker that would need that second click anyway. */
                        <div className="w-44" onClick={e => e.stopPropagation()}>
                            <Dropdown
                                value=""
                                onChange={v => { onAddOther(v); setAddingContributor(false) }}
                                options={addOtherOptions}
                                placeholder="Add…"
                                triggerClassName={dropdownTriggerClassName}
                                searchable
                                label="Add contributor"
                                defaultOpen
                                onOpenChange={isOpen => { if (!isOpen) setAddingContributor(false) }}
                            />
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={e => { e.stopPropagation(); if (canAssign) setAddingContributor(true); else onAddSelf() }}
                            className={`hover:border-(--theme-text-contrast) hover:text-(--theme-text-contrast) text-xs ${focusRing}`}
                            style={{
                                font: "inherit", background: "transparent",
                                height: 28, padding: "0 12px", borderRadius: 999, border: "1px dashed var(--theme-outline)",
                                cursor: "pointer", display: "grid", placeItems: "center", color: "var(--theme-subtext-color)",
                            }}
                        >
                            {canAssign ? "+ Add" : "+ Join"}
                        </button>
                    )
                )}
            </div>
        </div>
    )
}
