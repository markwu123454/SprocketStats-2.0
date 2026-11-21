import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Ban, Check, RotateCcw } from "lucide-react"
import { useAuth } from "@/contexts/authContext"
import { useBootstrapped } from "@/contexts/bootstrapContext"
import { confirmDialog } from "@/lib/confirmDialog"
import { can, canModerate, getPerm, type RoleCatalogEntry } from "@/lib/permissions"
import {
    nameOf, norm, pretty, rosterOrder, statusOf,
    type MemberRow, type ProfilePatch, type RowAction,
} from "@/lib/members"

const API = import.meta.env.VITE_BACKEND_URL

const withTags = (members: MemberRow[], tagMap: Record<string, string[]> | null): MemberRow[] =>
    members.map(m => ({ ...m, tags: tagMap?.[m.id] ?? [] }))

/** Throws the server's message (FastAPI's string `detail`) when `res` failed, else `fallback`. */
async function assertOk(res: Response, fallback: string): Promise<void> {
    if (res.ok) return
    const detail = await res.json().then((b: { detail?: unknown }) => b.detail, () => null)
    throw new Error(typeof detail === "string" ? detail : fallback)
}

/** `fetch`, turning a network failure into the same kind of user-facing error as a refused request. */
async function send(url: string, init: RequestInit, fallback: string): Promise<Response> {
    let res: Response
    try {
        res = await fetch(url, { credentials: "include", ...init })
    } catch {
        throw new Error(`${fallback} — check your connection`)
    }
    await assertOk(res, fallback)
    return res
}

/**
 * The Members page's state: the roster, and every change to it. Each change
 * saves as soon as it's made: profile edits (name, display name, role, grade,
 * year), approve, ban and unban, tags, and kiosk access. A role change, a ban
 * and an unban ask first. Profile edits show at once and are undone if the
 * server refuses them; the others show once the server has accepted them. Every
 * call rejects with a message to show.
 *
 * Lives above both roster views (the desktop grid and the phone list), so
 * crossing the `md` breakpoint swaps the view without losing anything.
 *
 * Captains, Mentors and the Scouting Lead can edit anyone; Leads can edit their
 * own subteam's members (and alumni), except for their role. The `/members`
 * endpoints enforce the same scope; this is cosmetic, the backend is the real boundary.
 */
export function useMembersRoster() {
    const { user } = useAuth()

    // Bootstrap pre-seeds — null means "not yet resolved", [] means "resolved but empty"
    const [bMembers, setBMembers] = useBootstrapped<MemberRow[] | null>("members", null)
    const [bTagMap, setBTagMap]   = useBootstrapped<Record<string, string[]> | null>("tag_assignments", null)

    const [rows, setRows] = useState<MemberRow[]>(() => (bMembers ? withTags(bMembers, bTagMap) : []))
    const [catalog, setCatalog] = useBootstrapped<RoleCatalogEntry[]>("roles", [])

    // Captains, Mentors and the Scouting Lead (control_panel.members) edit anyone,
    // role included. Leads edit within their moderation scope — their subteam's
    // members and alumni — but can't change anyone's role.
    const canManage = can(user?.permissions, "control_panel.members")
    // Tag editing is available to anyone with roster access: Captains, Mentors,
    // and Leads (anyone with a can_moderate spec on their policy).
    const canEditTags = canManage || Boolean(getPerm(user?.permissions, "can_moderate"))

    const [loading, setLoading] = useState(bMembers === null)
    // Tracks whether the real load() has started; prevents bootstrap from overwriting fresh data.
    const loadStarted = useRef(false)
    // Set once the server's roster is on screen.
    const haveFresh = useRef(false)
    const [error, setError] = useState<string | null>(null)
    // Members with an approve/ban/unban on its way to the server, so it can't be pressed twice.
    const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set())

    // Seed rows from bootstrap if it resolves after this component mounted
    // but before load() has started (async case on slow connections).
    useEffect(() => {
        if (loadStarted.current || !bMembers) return
        setRows(withTags(bMembers, bTagMap))
        setLoading(false)
    }, [bMembers, bTagMap])

    const load = useCallback(async () => {
        loadStarted.current = true
        setError(null)
        try {
            const [mRes, rRes, tRes] = await Promise.all([
                fetch(`${API}/members`, { credentials: "include" }),
                fetch(`${API}/auth/roles`, { credentials: "include" }),
                fetch(`${API}/tags/assignments`, { credentials: "include" }),
            ])
            if (!mRes.ok) throw new Error("members")
            const members = await mRes.json() as MemberRow[]
            const tagMap: Record<string, string[]> = tRes.ok ? await tRes.json() as Record<string, string[]> : {}
            if (rRes.ok) setCatalog(await rRes.json() as RoleCatalogEntry[])
            setRows(withTags(members, tagMap))
            haveFresh.current = true
        } catch {
            setError("Couldn't load members")
        } finally {
            setLoading(false)
        }
    }, [setCatalog])

    useEffect(() => { void load() }, [load])

    // Once the server's roster is on screen, it (and every change made here) is
    // what the page starts from next time, not the roster from app load.
    useEffect(() => {
        if (!haveFresh.current) return
        setBMembers(rows)
        setBTagMap(Object.fromEntries(rows.map(r => [r.id, r.tags])))
    }, [rows, setBMembers, setBTagMap])

    const roleById = useMemo(() => new Map(catalog.map(c => [c.value, c])), [catalog])
    const order = useMemo(() => rosterOrder(catalog), [catalog])

    /** Whether the viewer may edit the profile of a member holding `role`. */
    const canEditMember = useCallback((role: string | null) =>
        canManage || canModerate(user?.permissions, role, catalog), [canManage, user, catalog])

    const patchRow = useCallback((id: string, patch: Partial<MemberRow>) => {
        setRows(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)))
    }, [])

    /** Asks before moving `member` to `next.role`, saying what else changes with it. */
    const confirmRoleChange = useCallback((member: MemberRow, next: MemberRow) => {
        const label = (role: string | null) => (role ? roleById.get(role)?.label ?? pretty(role) : "no role")
        const notes = [`${nameOf(member)} goes from ${label(member.role)} to ${label(next.role)}.`]
        // The server clears an approval on a role change: it vouched for the old role.
        if (member.approved_by) notes.push("Their approval is cleared, so they'll need approving again.")
        const needsSchoolInfo = next.role ? roleById.get(next.role)?.school_info_required : false
        if (needsSchoolInfo && (!next.grade || !next.team_year)) {
            notes.push(`${label(next.role)} is a student role, and their grade and year are blank.`)
        }
        return confirmDialog({
            title: `Change ${nameOf(member)}'s role?`,
            body: notes.join(" "),
            confirmLabel: "Change role",
        })
    }, [roleById])

    /**
     * Save profile fields for `member`. A role change asks first; resolves false
     * if the person backs out. The row shows the change at once and goes back if
     * the server refuses it. A role change also clears the member's approval, as
     * the server does (an approval vouches for one role).
     */
    const updateProfile = useCallback(async (member: MemberRow, patch: ProfilePatch): Promise<boolean> => {
        const next = { ...member, ...patch }
        const roleChanged = norm(next.role) !== norm(member.role)
        if (roleChanged && !await confirmRoleChange(member, next)) return false
        const before: Partial<MemberRow> = {
            name: member.name, display_name: member.display_name, role: member.role,
            grade: member.grade, team_year: member.team_year, approved_by: member.approved_by,
        }
        patchRow(member.id, { ...patch, ...(roleChanged ? { approved_by: null } : {}) })
        try {
            // The endpoint writes every profile field (a missing one becomes NULL), so send them all.
            await send(`${API}/members`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify([{
                    id: member.id,
                    name: norm(next.name),
                    display_name: norm(next.display_name),
                    role: next.role,
                    grade: norm(next.grade),
                    team_year: norm(next.team_year),
                }]),
            }, `Couldn't save ${nameOf(next)}`)
        } catch (e) {
            patchRow(member.id, before)
            throw e
        }
        return true
    }, [patchRow, confirmRoleChange])

    /** Runs a moderation call for `id`, marking the member busy while it's in flight. */
    const moderate = useCallback(async (id: string, call: () => Promise<Partial<MemberRow>>) => {
        setBusy(prev => new Set(prev).add(id))
        try {
            patchRow(id, await call())
        } finally {
            setBusy(prev => { const next = new Set(prev); next.delete(id); return next })
        }
    }, [patchRow])

    const approve = useCallback((m: MemberRow) => moderate(m.id, async () => {
        const res = await send(`${API}/members/${m.id}/approve`, { method: "POST" }, `Couldn't approve ${nameOf(m)}`)
        const body = await res.json() as { approved_by: string | null }
        return { approved_by: body.approved_by }
    }), [moderate])

    const setBanned = useCallback((m: MemberRow, banned: boolean) => moderate(m.id, async () => {
        const res = await send(`${API}/members/${m.id}/ban`, { method: banned ? "POST" : "DELETE" },
            `Couldn't ${banned ? "ban" : "unban"} ${nameOf(m)}`)
        const body = await res.json() as { banned_at: string | null }
        return { banned_at: body.banned_at }
    }), [moderate])

    const addTag = useCallback(async (userId: string, tag: string) => {
        await send(`${API}/tags/user/${userId}/${tag}`, { method: "POST" }, `Couldn't add "${tag}"`)
        setRows(prev => prev.map(r =>
            r.id === userId && !r.tags.includes(tag) ? { ...r, tags: [...r.tags, tag].sort() } : r))
    }, [])

    const removeTag = useCallback(async (userId: string, tag: string) => {
        await send(`${API}/tags/user/${userId}/${tag}`, { method: "DELETE" }, `Couldn't remove "${tag}"`)
        setRows(prev => prev.map(r => (r.id === userId ? { ...r, tags: r.tags.filter(t => t !== tag) } : r)))
    }, [])

    /** Grant (minutes, or null for no end) or revoke kiosk access. */
    const setKioskAccess = useCallback(async (userId: string, minutes: number | null | "revoke") => {
        const res = await send(`${API}/members/${userId}/kiosk_access`, minutes === "revoke"
            ? { method: "DELETE" }
            : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ minutes }) },
            "Couldn't update kiosk access")
        const body = await res.json() as Pick<MemberRow, "kiosk_access_until" | "kiosk_access_no_end">
        patchRow(userId, { kiosk_access_until: body.kiosk_access_until, kiosk_access_no_end: body.kiosk_access_no_end })
    }, [patchRow])

    /** The single moderation action for a member: approve, ban or unban. Ban and unban ask first. */
    const actionFor = (m: MemberRow): RowAction => {
        const isSelf = m.id === user?.id
        const inScope = canModerate(user?.permissions, m.role, catalog)
        const scopeReason = isSelf ? "You can't moderate yourself"
            : !inScope ? "This member is outside your moderation scope" : undefined
        const inFlight = busy.has(m.id)
        const status = statusOf(m)
        if (status === "banned") {
            return {
                label: "Unban", icon: RotateCcw, disabled: !!scopeReason || inFlight, reason: scopeReason,
                run: async () => {
                    const ok = await confirmDialog({
                        title: `Unban ${nameOf(m)}?`,
                        body: "They get their access to SprocketStats back.",
                        confirmLabel: "Unban",
                    })
                    if (ok) await setBanned(m, false)
                    return ok
                },
            }
        }
        if (status === "pending") {
            const reason = scopeReason ?? (!m.display_name ? "Member hasn't finished onboarding" : undefined)
            return {
                label: "Approve", icon: Check, disabled: !!reason || inFlight, reason,
                run: async () => { await approve(m); return true },
            }
        }
        return {
            label: "Ban", icon: Ban, disabled: !!scopeReason || inFlight, reason: scopeReason,
            run: async () => {
                const ok = await confirmDialog({
                    title: `Ban ${nameOf(m)}?`,
                    body: "They lose access to SprocketStats until they're unbanned.",
                    confirmLabel: "Ban",
                    danger: true,
                })
                if (ok) await setBanned(m, true)
                return ok
            },
        }
    }

    /** Why the viewer can't change this member's kiosk access, or undefined when they can. */
    const kioskBlockedReason = (m: MemberRow): string | undefined =>
        m.id === user?.id ? "You can't change your own kiosk access"
            : !canModerate(user?.permissions, m.role, catalog) ? "This member is outside your moderation scope"
            : m.banned_at ? "Banned members can't use kiosks"
            : undefined

    return {
        rows, catalog, roleById, order,
        loading, error, setError,
        canManage, canEditTags, canEditMember,
        updateProfile, addTag, removeTag, setKioskAccess,
        actionFor, kioskBlockedReason,
    }
}
