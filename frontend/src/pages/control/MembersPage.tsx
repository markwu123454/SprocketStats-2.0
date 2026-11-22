import { lazy, Suspense, useState } from "react"
import Notice from "@/components/ui/Notice"
import { MembersSkeleton } from "@/components/members/MemberBits"
import MembersList from "@/components/members/MembersList"
import { EditMemberSheet, KioskAccessSheet, TagsSheet } from "@/components/members/MemberSheets"
import type { MemberActions, ProfilePatch, MemberRow, Tab } from "@/lib/members"
import { useIsMobile } from "@/lib/useIsMobile"
import { useMembersRoster } from "@/lib/useMembersRoster"

// AG Grid is large and only the desktop roster uses it, so it loads with the grid.
const MembersGrid = lazy(() => import("@/components/members/MembersGrid"))

/**
 * Members control page — the roster.
 *
 * This page owns everything both layouts share: the roster (useMembersRoster),
 * the error notice, the phone list's search and status tab, and the profile,
 * tags and kiosk sheets. Each layout only draws the roster: from `md` up an AG
 * Grid (MembersGrid: sortable, filterable columns, Role, Grade and Year edited
 * in place), below it a grouped list where tapping a member opens a sheet with
 * every action (MembersList). Every change saves as soon as it's made.
 */
export default function MembersPage() {
    const isMobile = useIsMobile()
    const roster = useMembersRoster()
    const { rows, catalog, loading, error, setError } = roster

    const [editingFor, setEditingFor]         = useState<string | null>(null)
    const [editingTagsFor, setEditingTagsFor] = useState<string | null>(null)
    const [kioskFor, setKioskFor]             = useState<string | null>(null)
    // The phone list's filters, kept here so they survive a switch to the grid and back.
    const [query, setQuery] = useState("")
    const [tab, setTab]     = useState<Tab>("all")

    const showError = (e: unknown) => setError(e instanceof Error ? e.message : "Something went wrong")

    const actions: MemberActions = {
        roleById: roster.roleById,
        onError: showError,
        actionFor: roster.actionFor,
        onEdit: m => (roster.canEditMember(m.role) ? () => setEditingFor(m.id) : undefined),
        onEditTags: m => (roster.canEditTags ? () => setEditingTagsFor(m.id) : undefined),
        kioskBlocked: roster.kioskBlockedReason,
        onKioskAccess: m => setKioskFor(m.id),
        onRevokeKiosk: m => {
            setError(null)
            void roster.setKioskAccess(m.id, "revoke").catch(showError)
        },
    }

    /** An in-place grid edit: saves straight away, and the row goes back if it fails. */
    const updateFromGrid = (m: MemberRow, patch: ProfilePatch) => {
        setError(null)
        void roster.updateProfile(m, patch).catch(showError)
    }

    const editingMember = editingFor ? rows.find(r => r.id === editingFor) : undefined
    const kioskMember = kioskFor ? rows.find(r => r.id === kioskFor) : undefined
    const editingTagsMember = editingTagsFor ? rows.find(r => r.id === editingTagsFor) : undefined

    return (
        // Desktop pins the card to the viewport and scrolls the grid inside it; on
        // mobile the whole page scrolls (overflow-clip, not hidden, so the group
        // headers can still stick) to give the list the full screen.
        <div className="px-4 py-3 md:px-6 md:py-6 flex flex-col gap-4 md:h-full">
            <div className="rounded-xl border overflow-clip md:overflow-hidden theme-border theme-bg flex flex-col md:flex-1 md:min-h-0">
                <div className="shrink-0 px-4 md:px-6 py-4 border-b theme-border">
                    <h1 className="text-2xl font-bold leading-tight theme-h1-color">Members</h1>
                </div>

                {error && <Notice className="mx-4 md:mx-6 mt-3 shrink-0" onDismiss={() => setError(null)}>{error}</Notice>}

                {isMobile ? (
                    <MembersList
                        members={rows}
                        loading={loading}
                        order={roster.order}
                        query={query}
                        onQueryChange={setQuery}
                        tab={tab}
                        onTabChange={setTab}
                        actions={actions}
                    />
                ) : loading ? <MembersSkeleton /> : (
                    <Suspense fallback={<MembersSkeleton />}>
                        <MembersGrid
                            members={rows}
                            catalog={catalog}
                            compareRoster={roster.order.compare}
                            canManage={roster.canManage}
                            canEditMember={roster.canEditMember}
                            onUpdate={updateFromGrid}
                            actions={actions}
                        />
                    </Suspense>
                )}
            </div>

            {editingMember && (
                <EditMemberSheet
                    member={editingMember}
                    catalog={catalog}
                    canChangeRole={roster.canManage}
                    onClose={() => setEditingFor(null)}
                    onSave={patch => roster.updateProfile(editingMember, patch)}
                />
            )}

            {kioskMember && (
                <KioskAccessSheet
                    member={kioskMember}
                    onClose={() => setKioskFor(null)}
                    onSubmit={minutes => roster.setKioskAccess(kioskMember.id, minutes)}
                />
            )}

            {editingTagsMember && (
                <TagsSheet
                    member={editingTagsMember}
                    onClose={() => setEditingTagsFor(null)}
                    onAdd={roster.addTag}
                    onRemove={roster.removeTag}
                />
            )}
        </div>
    )
}
