/**
 * Audience picker shared by Push → Compose ("Send to") and the notice editor
 * ("Applies to") so the two never drift — a faithful build of the prototype's
 * "audience-first" component.
 *
 * Layout: a row of quick-pick chips (Everyone / All Members / Subteam Leads /
 * Staff / Clear), then one section per org division (Engineering / Business),
 * each holding a grid of **subteam cards**. A card has a tri-state toggle for
 * the whole subteam plus a Member / Lead chip per tier. Team-wide roles with no
 * subteam (Captain / Mentor / Alumni) sit in a final "Staff & Others" chip row,
 * so nothing is ever dropped.
 *
 * Everything is driven by each role's `subteam` and `level` (from
 * `GET /auth/roles`) — the real role catalog is already `{subteam}_member` /
 * `{subteam}_lead`, which maps 1:1 onto the card model.
 *
 * Selection is normalized so an **empty** `selected` means *everyone*: whenever
 * every role is checked, `onChange` reports `[]`. That keeps the "no filter =
 * all users" convention the backend expects (`target_roles = '{}'`) in one
 * place instead of duplicated across callers.
 */

export interface RoleMeta {
    value: string
    label: string
    subteam?: string | null
    level?: string | null
}

const DIVISIONS: { id: string; label: string; subteams: string[] }[] = [
    { id: "eng", label: "Engineering", subteams: ["programming", "scouting", "cad", "electrical", "manufacturing", "mechanical"] },
    { id: "biz", label: "Business",    subteams: ["outreach", "operations", "publicity"] },
]

/** Order tiers within a card: Member, then Lead, then anything else. */
const TIER_RANK: Record<string, number> = { member: 0, lead: 1 }

/** "scouting_lead" → "Scouting Lead" */
function pretty(v: string): string {
    return v.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
}

/** "member" → "Member" (chip label for a tier). */
function tierLabel(level: string | null | undefined): string {
    if (!level) return "Role"
    return level.charAt(0).toUpperCase() + level.slice(1)
}

/** Subteam display name, taken from a role label by dropping its tier suffix
 *  ("CAD Member" → "CAD") so we keep the catalog's casing (CAD, not Cad). */
function subteamLabel(role: RoleMeta): string {
    return role.label.replace(/\s+(Member|Lead)$/i, "").trim() || pretty(role.subteam ?? "")
}

type TriState = "all" | "some" | "none"

function triState(values: string[], checked: Set<string>): TriState {
    const on = values.filter(v => checked.has(v)).length
    return on === 0 ? "none" : on === values.length ? "all" : "some"
}

/** The little square box that fronts a subteam / division toggle. */
function TriBox({ state }: { state: TriState }) {
    const filled = state === "all"
    return (
        <span
            aria-hidden
            className="flex items-center justify-center shrink-0 rounded-[5px] text-[11px] font-extrabold"
            style={{
                width: 17,
                height: 17,
                border: `1px solid ${state === "none" ? "var(--theme-border)" : "var(--theme-text-contrast)"}`,
                background: filled ? "var(--theme-text-contrast)" : "transparent",
                color: filled ? "var(--theme-bg)" : "var(--theme-text-contrast)",
            }}
        >
            {filled ? "✓" : state === "some" ? "–" : ""}
        </span>
    )
}

function chipStyle(on: boolean): React.CSSProperties {
    return on
        ? {
            border: "1px solid var(--theme-text-contrast)",
            background: "color-mix(in oklch, var(--theme-text-contrast) 12%, transparent)",
            color: "var(--theme-text-contrast)",
            fontWeight: 600,
        }
        : {
            border: "1px solid var(--theme-border)",
            color: "var(--theme-subtext-color)",
            fontWeight: 500,
        }
}

export default function RoleAudienceSelect(
    { catalog, selected, onChange }:
    {
        catalog: RoleMeta[]
        /** Currently-targeted roles; an empty array means *everyone*. */
        selected: string[]
        /** Reports the new selection, already normalized ([] when all are on). */
        onChange: (roles: string[]) => void
    },
) {
    const allValues = catalog.map(r => r.value)
    // Empty selection is the "everyone" sentinel — render it as all-checked.
    const checked = selected.length === 0 ? new Set(allValues) : new Set(selected)

    /** Normalize before reporting: a full set collapses back to [] ("everyone"). */
    function commit(next: Set<string>) {
        if (allValues.length > 0 && allValues.every(v => next.has(v))) onChange([])
        else onChange(allValues.filter(v => next.has(v)))
    }

    function setRoles(values: string[], on: boolean) {
        const next = new Set(checked)
        values.forEach(v => (on ? next.add(v) : next.delete(v)))
        commit(next)
    }

    // ---- build the subteam → tiers model ----
    const bySubteam = new Map<string, RoleMeta[]>()
    const noSubteam: RoleMeta[] = []
    for (const role of catalog) {
        if (role.subteam) {
            const arr = bySubteam.get(role.subteam) ?? []
            arr.push(role)
            bySubteam.set(role.subteam, arr)
        } else {
            noSubteam.push(role)
        }
    }
    for (const roles of bySubteam.values()) {
        roles.sort((a, b) => (TIER_RANK[a.level ?? ""] ?? 9) - (TIER_RANK[b.level ?? ""] ?? 9))
    }

    // Order subteams by division; anything unmapped falls into a trailing "Other".
    const placed = new Set<string>()
    const sections = DIVISIONS.map(d => {
        const subteams = d.subteams.filter(s => bySubteam.has(s))
        subteams.forEach(s => placed.add(s))
        return { id: d.id, label: d.label, subteams }
    }).filter(s => s.subteams.length > 0)
    const leftover = [...bySubteam.keys()].filter(s => !placed.has(s))
    if (leftover.length) sections.push({ id: "other", label: "Other", subteams: leftover })

    const quickPicks: { label: string; roles: string[] }[] = [
        { label: "Everyone", roles: allValues },
        { label: "All Members", roles: catalog.filter(r => r.level === "member").map(r => r.value) },
        { label: "Subteam Leads", roles: catalog.filter(r => r.level === "lead").map(r => r.value) },
        { label: "Staff", roles: catalog.filter(r => r.level === "captain" || r.level === "mentor").map(r => r.value) },
    ]
    const eq = (roles: string[]) => roles.length > 0 && roles.length === checked.size && roles.every(r => checked.has(r))

    return (
        <div className="flex flex-col gap-4">
            {/* Quick picks */}
            <div className="flex flex-wrap gap-2">
                {quickPicks.filter(q => q.roles.length > 0).map(q => {
                    const on = eq(q.roles)
                    return (
                        <button
                            key={q.label}
                            type="button"
                            onClick={() => onChange(q.label === "Everyone" ? [] : q.roles)}
                            className="rounded-full border px-3 py-1 text-xs font-semibold transition-opacity hover:opacity-80"
                            style={on
                                ? { background: "var(--theme-text-contrast)", color: "var(--theme-bg)", borderColor: "var(--theme-text-contrast)" }
                                : { color: "var(--theme-subtext-color)", borderColor: "var(--theme-border)" }}
                        >
                            {q.label}
                        </button>
                    )
                })}
                <button
                    type="button"
                    onClick={() => onChange(allValues)}
                    className="rounded-full border px-3 py-1 text-xs font-medium theme-subtext-color theme-border transition-opacity hover:opacity-80"
                    title="Deselect all roles"
                >
                    Clear
                </button>
            </div>

            {/* Division sections */}
            {sections.map(sec => {
                const secValues = sec.subteams.flatMap(s => (bySubteam.get(s) ?? []).map(r => r.value))
                const secState = triState(secValues, checked)
                return (
                    <div key={sec.id} className="flex flex-col gap-2.5">
                        <button
                            type="button"
                            onClick={() => setRoles(secValues, secState !== "all")}
                            className="flex w-fit items-center gap-2"
                        >
                            <TriBox state={secState} />
                            <span className="text-xs font-semibold uppercase tracking-widest theme-subtext-color">{sec.label}</span>
                            <span className="text-xs theme-subtext-color opacity-60">
                                {sec.subteams.length} subteam{sec.subteams.length === 1 ? "" : "s"}
                            </span>
                        </button>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {sec.subteams.map(s => {
                                const tiers = bySubteam.get(s) ?? []
                                const values = tiers.map(r => r.value)
                                const state = triState(values, checked)
                                const onCount = values.filter(v => checked.has(v)).length
                                return (
                                    <div key={s} className="flex flex-col gap-2.5 rounded-xl border p-3 theme-border" style={{ background: "var(--theme-bg)" }}>
                                        <button
                                            type="button"
                                            onClick={() => setRoles(values, state !== "all")}
                                            className="flex items-center gap-2"
                                        >
                                            <TriBox state={state} />
                                            <span className="flex-1 text-left text-sm font-semibold theme-text">{subteamLabel(tiers[0])}</span>
                                            <span className="text-xs theme-subtext-color">{onCount ? `${onCount}/${values.length}` : ""}</span>
                                        </button>
                                        <div className="flex flex-wrap gap-1.5">
                                            {tiers.map(t => {
                                                const on = checked.has(t.value)
                                                return (
                                                    <button
                                                        key={t.value}
                                                        type="button"
                                                        aria-pressed={on}
                                                        onClick={() => setRoles([t.value], !on)}
                                                        className="rounded-full px-3 py-1 text-xs transition-opacity hover:opacity-80"
                                                        style={chipStyle(on)}
                                                    >
                                                        {tierLabel(t.level)}
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )
            })}

            {/* Team-wide roles with no subteam */}
            {noSubteam.length > 0 && (
                <div className="flex flex-wrap items-center gap-2.5 rounded-xl border p-3 theme-border" style={{ background: "var(--theme-bg)" }}>
                    <span className="text-sm font-semibold theme-text">Staff &amp; Others</span>
                    <div className="flex flex-wrap gap-1.5">
                        {noSubteam.map(r => {
                            const on = checked.has(r.value)
                            return (
                                <button
                                    key={r.value}
                                    type="button"
                                    aria-pressed={on}
                                    onClick={() => setRoles([r.value], !on)}
                                    className="rounded-full px-3 py-1 text-xs transition-opacity hover:opacity-80"
                                    style={chipStyle(on)}
                                >
                                    {r.label || pretty(r.value)}
                                </button>
                            )
                        })}
                    </div>
                </div>
            )}
        </div>
    )
}
