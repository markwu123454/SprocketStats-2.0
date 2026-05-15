import Dexie, { type Table } from "dexie"

export type Settings = {
    key: string
    theme?: "theme-2025" | "theme-2026" | "theme-2027"
}

class SettingsDatabase extends Dexie {
    settings!: Table<Settings>

    constructor() {
        super("sprocket-settings")
        this.version(1).stores({ settings: "key" })
    }
}

const db = new SettingsDatabase()

export async function getSetting<K extends keyof Omit<Settings, "key">>(
    key: K
): Promise<Settings[K] | undefined> {
    const row = await db.settings.get(key)
    return row?.[key] as Settings[K] | undefined
}

export function getSettingSync<K extends keyof Omit<Settings, "key">>(
    _key: K
): Settings[K] | undefined {
    return undefined
}

export async function setSetting(values: Partial<Omit<Settings, "key">>) {
    for (const [key, value] of Object.entries(values)) {
        await db.settings.put({ key, [key]: value })
    }
}