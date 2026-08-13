const API = import.meta.env.VITE_BACKEND_URL

export interface CompEventLinks {
    tba?: string | null
    statbotics?: string | null
    nexus?: string | null
    youtube?: string | null
    twitch?: string | null
}

export interface ItineraryItem {
    dt: string
    label: string
    detail: string | null
}

export interface PackingCategory {
    category: string
    items: string[]
}

export interface Instruction {
    heading: string
    body: string
}

export interface RosterMember {
    user_id: string | null
    display_name: string
    role: string
    phone: string | null
}

export interface TBAMatch {
    key: string
    comp_level: string
    set_number: number
    match_number: number
    alliances: {
        red: { team_keys: string[]; score: number }
        blue: { team_keys: string[]; score: number }
    }
    winning_alliance: string
    scheduled_time: number | null
    predicted_time: number | null
    actual_time: number | null
    post_result_time: number | null
}

export interface TBARankEntry {
    rank: number
    team_key: string
    matches_played: number
    record: { wins: number; losses: number; ties: number }
    sort_orders: number[]
}

export interface NexusData {
    status: { nowQueuing?: string; [key: string]: unknown } | null
    inspection: Record<string, { inspected?: boolean; [key: string]: unknown }> | null
}

export interface EventInfo {
    event_key: string
    event_name: string
    links: CompEventLinks | null
    itinerary: ItineraryItem[] | null
    packing_list: PackingCategory[] | null
    instructions: Instruction[] | null
    roster: RosterMember[] | null
    matches: TBAMatch[]
    rankings: { rankings: TBARankEntry[] } | null
    nexus: NexusData | null
}

export interface EventUpdate {
    matches: TBAMatch[]
    rankings: { rankings: TBARankEntry[] } | null
    nexus: NexusData | null
}

async function apiFetch<T>(path: string): Promise<T> {
    const res = await fetch(`${API}${path}`, { credentials: "include" })
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status })
    return res.json() as Promise<T>
}

export function fetchEventInfo(eventKey: string) {
    return apiFetch<EventInfo>(`/events/${eventKey}/info`)
}

export function fetchEventUpdate(eventKey: string) {
    return apiFetch<EventUpdate>(`/events/${eventKey}/update`)
}
