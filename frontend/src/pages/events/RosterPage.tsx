import { AgGridReact } from "ag-grid-react"
import type { ColDef, SizeColumnsToFitGridStrategy } from "ag-grid-community"
import { Phone } from "lucide-react"
import { useEventContext } from "@/contexts/eventContext"
import type { RosterMember } from "@/lib/eventApi"

const ROLE_ORDER = ["mentor", "chaperone", "captain", "lead", "drive_team", "pit_crew", "attending"]

function humanizeRole(role: string): string {
    return role.split("_").map(w => w[0].toUpperCase() + w.slice(1)).join(" ")
}

function roleSort(a: string, b: string): number {
    const ai = ROLE_ORDER.indexOf(a)
    const bi = ROLE_ORDER.indexOf(b)
    if (ai !== -1 && bi !== -1) return ai - bi
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return a.localeCompare(b)
}

function PhoneCell({ value }: { value: string | null }) {
    if (!value) return <span style={{ color: "var(--theme-subtext-color)" }}>—</span>
    return (
        <a
            href={`tel:${value}`}
            className="inline-flex items-center gap-1 transition-opacity hover:opacity-70"
            style={{ color: "var(--theme-text-contrast)" }}
        >
            <Phone size={12} />
            {value}
        </a>
    )
}

const AUTO_SIZE_STRATEGY: SizeColumnsToFitGridStrategy = { type: "fitGridWidth" }

const DEFAULT_COL_DEF: ColDef = {
    flex: 1,
    resizable: true,
    suppressMovable: true,
}

const COL_DEFS: ColDef<RosterMember>[] = [
    {
        field: "display_name",
        headerName: "Name",
        sortable: true,
        filter: true,
    },
    {
        field: "role",
        headerName: "Role",
        sortable: true,
        filter: true,
        valueFormatter: p => humanizeRole(p.value ?? ""),
        comparator: (a, b) => roleSort(a, b),
    },
    {
        field: "phone",
        headerName: "Phone",
        sortable: true,
        cellRenderer: PhoneCell,
        comparator: (a: string | null, b: string | null) => {
            if (a && !b) return -1
            if (!a && b) return 1
            return 0
        },
    },
]

function NoRosterOverlay() {
    return <span style={{ color: "var(--theme-subtext-color)" }}>Roster not yet posted.</span>
}

export default function RosterPage() {
    const { info } = useEventContext()

    return (
        <div className="h-full px-4 py-4 flex flex-col">
            <div className="rounded-xl overflow-hidden border theme-border flex-1 min-h-0">
                <AgGridReact
                    rowData={info?.roster ?? []}
                    columnDefs={COL_DEFS}
                    defaultColDef={DEFAULT_COL_DEF}
                    autoSizeStrategy={AUTO_SIZE_STRATEGY}
                    noRowsOverlayComponent={NoRosterOverlay}
                    initialState={{
                        sort: { sortModel: [{ colId: "role", sort: "asc" }] },
                    }}
                    suppressCellFocus
                    domLayout="normal"
                />
            </div>
        </div>
    )
}

function PageState({ children }: { children: string }) {
    return (
        <div className="flex items-center justify-center py-16">
            <span className="text-sm" style={{ color: "var(--theme-subtext-color)" }}>{children}</span>
        </div>
    )
}
