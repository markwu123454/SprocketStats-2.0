// Task board buckets — the 8 subteam slugs plus "general" for cross-team work.
// Mirrors the fixed list the backend validates `bucket` against (see
// backend/core/permissions.py / TASKS_CONTRACT.md). The frontend has no role
// catalog entry that maps 1:1 to "subteam slug, no attached role" to derive
// this from, so it's kept as an explicit, spec-pinned list here instead.

export const TASK_BUCKETS = [
    "cad",
    "electrical",
    "manufacturing",
    "programming",
    "scouting",
    "publicity",
    "operations",
    "outreach",
    "general",
] as const

export type TaskBucket = (typeof TASK_BUCKETS)[number]

/** `true` iff `value` is one of the known bucket slugs. */
export function isTaskBucket(value: string | null | undefined): value is TaskBucket {
    return value != null && (TASK_BUCKETS as readonly string[]).includes(value)
}

/** "cad" → "CAD" (the one acronym), everything else → capitalized word. */
export function bucketLabel(bucket: string): string {
    if (bucket.toLowerCase() === "cad") return "CAD"
    return bucket.charAt(0).toUpperCase() + bucket.slice(1)
}

/** `{ value, label }` pairs for the 9 buckets, in the canonical order above —
 *  feeds both the create-form bucket picker and the left-rail filter list. */
export const BUCKET_OPTIONS = TASK_BUCKETS.map(b => ({ value: b, label: bucketLabel(b) }))
