/**
 * Client-side helpers for reading the role policy sent by the backend.
 *
 * The backend (permissions.py) owns the role → policy map and ships the current
 * user's resolved policy on `/auth/me` as `user.permissions`. The frontend never
 * decides *what* a role can do — it only reads the verdict from that policy to
 * gate UI (which is cosmetic; the backend still enforces access). Mirror of the
 * backend `get_perm` / `can` helpers so both sides read the nested policy the
 * same, null-safe way.
 */

/** A value stored in a policy object: a leaf or a nested policy. */
export type PermValue = boolean | number | string | string[] | PermPolicy

/** A role policy object: nested access permissions + role attributes. */
export interface PermPolicy {
    [key: string]: PermValue
}

/** One entry in the role catalog returned by `GET /roles`. Used by the onboarding
 *  picker and by the Members roster to place a row (`level`/`subteam`) when
 *  deciding whether the current user may moderate it. */
export interface RoleCatalogEntry {
    value: string
    label: string
    school_info_required: boolean
    level: string
    subteam: string | null
    requires_approval: boolean
}

/** The `can_moderate` spec carried on a role policy (see backend permissions.py).
 *  `scope: "all"` clears any target; `scope: "subteam"` clears targets whose
 *  `level` is in `target_levels` and whose subteam matches the actor's, plus any
 *  role in `extra_roles`. Absent on roles with no moderation authority. */
interface ModerateSpec {
    scope?: string
    target_levels?: string[]
    extra_roles?: string[]
}

/**
 * Safely read a value from a policy object by dotted path.
 *
 * Walks an `"a.b.c"` path through the nested policy, returning `undefined` the
 * moment any segment is missing rather than throwing. This is the only supported
 * way to read nested policy values — never index the object directly, so a
 * missing branch can't crash the UI.
 *
 * @param perms A policy object (e.g. `user.permissions`), or null/undefined.
 * @param path Dotted key path, e.g. `"control_panel.view"`.
 * @returns The value at `path`, or `undefined` if any segment is absent.
 */
export function getPerm(perms: PermPolicy | null | undefined, path: string): PermValue | undefined {
    let node: PermValue | null | undefined = perms
    for (const key of path.split(".")) {
        if (node == null || typeof node !== "object" || Array.isArray(node) || !(key in node)) {
            return undefined
        }
        node = node[key]
    }
    return node
}

/**
 * Return whether a policy grants a boolean capability at `path`.
 *
 * Truthiness wrapper over {@link getPerm} for the common yes/no UI check, e.g.
 * `can(user.permissions, "control_panel.view")`. A missing path is `false`.
 *
 * @param perms A policy object, or null/undefined.
 * @param path Dotted capability path, e.g. `"control_panel.view"`.
 * @returns `true` if the value at `path` is truthy, else `false`.
 */
export function can(perms: PermPolicy | null | undefined, path: string): boolean {
    return Boolean(getPerm(perms, path))
}

/**
 * Return whether the current user (with policy `myPolicy`) may moderate a member
 * holding `targetRole` — the same approve/ban scope the backend enforces in
 * `can_role_moderate`. This is cosmetic (it only enables/disables roster buttons);
 * the endpoints re-check it. `catalog` supplies the target role's `level`/`subteam`.
 *
 * @param myPolicy The acting user's resolved policy (`user.permissions`).
 * @param targetRole The role slug of the member being acted on.
 * @param catalog The role catalog from `GET /roles`.
 * @returns `true` if the action is within the user's scope, else `false`.
 */
export function canModerate(
    myPolicy: PermPolicy | null | undefined,
    targetRole: string | null | undefined,
    catalog: RoleCatalogEntry[],
): boolean {
    const raw = getPerm(myPolicy, "can_moderate")
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return false
    const spec = raw as unknown as ModerateSpec
    if (spec.scope === "all") return true
    if (spec.scope === "subteam") {
        if (targetRole != null && spec.extra_roles?.includes(targetRole)) return true
        const target = catalog.find(r => r.value === targetRole)
        if (!target || target.subteam == null) return false
        const mySubteam = getPerm(myPolicy, "subteam")
        return (spec.target_levels?.includes(target.level) ?? false) && target.subteam === mySubteam
    }
    return false
}
