import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
    type BootstrapCache, BootstrapContext, BootstrapLatestContext, BootstrapSavedAtContext, createBootstrapLatest,
} from "./bootstrapContext"
import { useAuth } from "./authContext"
import { loadOfflineSnapshot, saveOfflineSnapshot, updateOfflineSnapshot } from "@/lib/offline"

const API = import.meta.env.VITE_BACKEND_URL

interface Loaded {
    cache: BootstrapCache
    savedAt: number | null
    /** Came from the network this session, so it's worth saving for offline use. */
    fresh: boolean
}

const EMPTY: Loaded = { cache: {}, savedAt: null, fresh: false }

/**
 * Provides /bootstrap to every page (useBootstrapped). Fetched on app load in
 * parallel with the sign-in check, again when a member signs in later or the
 * app comes back online. Online, the offline subset is saved on the phone, and
 * kept current with whatever newer values pages fetch afterwards; offline, that
 * saved copy is what pages read (lib/offline.ts).
 */
export function BootstrapProvider({ children }: { children: ReactNode }) {
    const { user, offline } = useAuth()
    const userId = user?.id ?? null
    const [loaded, setLoaded] = useState<Loaded>(EMPTY)
    const lastLoad = useRef<Promise<boolean> | null>(null)
    // The newest value pages have had per key (see BootstrapLatestContext).
    // Online, each one also goes into the copy saved for offline use, so offline
    // shows the newest data this phone has seen rather than the app-load copy.
    const persistLatest = useRef<((key: string, value: unknown) => void) | null>(null)
    const [latest] = useState(() => createBootstrapLatest((key, value) => persistLatest.current?.(key, value)))
    useEffect(() => {
        persistLatest.current = userId && !offline ? (key, value) => updateOfflineSnapshot(userId, key, value) : null
    }, [userId, offline])

    const load = useCallback(() => {
        const request = fetch(`${API}/bootstrap`, { credentials: "include" })
            .then(r => (r.ok ? r.json() as Promise<BootstrapCache> : null))
            .then(data => {
                if (!data || Object.keys(data).length === 0) return false
                // Newer than anything pages fetched before it.
                latest.clear()
                setLoaded({ cache: data, savedAt: Date.now(), fresh: true })
                return true
            })
            .catch(() => false)
        lastLoad.current = request
        return request
    }, [latest])

    // App load: starts alongside /auth/me rather than after it.
    useEffect(() => { void load() }, [load])

    // A member who signs in after the app loaded (the load above was signed
    // out), or a different member, gets their own bootstrap.
    const lastUserId = useRef<string | null>(null)
    useEffect(() => {
        const previous = lastUserId.current
        lastUserId.current = userId
        if (userId === null) {
            if (previous !== null) {
                latest.clear()
                setLoaded(EMPTY)
            }
            return
        }
        if (offline || userId === previous) return
        if (previous !== null) {
            // A different member: nothing the last one's pages fetched applies.
            latest.clear()
            void load()
            return
        }
        void lastLoad.current?.then(ok => { if (!ok) void load() })
    }, [userId, offline, load, latest])

    // Back online after running on saved info: fetch fresh data.
    const wasOffline = useRef(offline)
    useEffect(() => {
        if (wasOffline.current && !offline && userId) void load()
        wasOffline.current = offline
    }, [offline, userId, load])

    // Online with fresh data: keep the offline subset on the phone. Once per
    // /bootstrap, so coming back online doesn't save that older copy over the
    // newer values pages have saved since (persistLatest above).
    const savedLoad = useRef<Loaded | null>(null)
    useEffect(() => {
        if (loaded.fresh && userId && !offline && loaded.savedAt !== null && savedLoad.current !== loaded) {
            saveOfflineSnapshot(userId, loaded.cache, loaded.savedAt)
            savedLoad.current = loaded
        }
    }, [loaded, userId, offline])

    // Offline with nothing fresh from this session: read the saved copy. Done
    // during render so pages mount with it already in place.
    const value = useMemo<Loaded>(() => {
        if (!offline || !userId || loaded.fresh) return loaded
        const snapshot = loadOfflineSnapshot(userId)
        return snapshot ? { cache: snapshot.data, savedAt: snapshot.savedAt, fresh: false } : loaded
    }, [offline, userId, loaded])

    return (
        <BootstrapContext.Provider value={value.cache}>
            <BootstrapLatestContext.Provider value={latest}>
                <BootstrapSavedAtContext.Provider value={value.savedAt}>
                    {children}
                </BootstrapSavedAtContext.Provider>
            </BootstrapLatestContext.Provider>
        </BootstrapContext.Provider>
    )
}
