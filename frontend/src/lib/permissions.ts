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

/** One entry in the onboarding role catalog returned by `GET /roles`. */
export interface RoleCatalogEntry {
    value: string
    label: string
    school_info_required: boolean
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
