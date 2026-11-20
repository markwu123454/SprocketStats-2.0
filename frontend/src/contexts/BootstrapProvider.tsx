import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { type BootstrapCache, BootstrapContext, BootstrapSavedAtContext } from "./bootstrapContext"
import { useAuth } from "./authContext"
import { loadOfflineSnapshot, saveOfflineSnapshot } from "@/lib/offline"

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
 * app comes back online. Online, the offline subset is saved on the phone;
 * offline, that saved copy is what pages read (lib/offline.ts).
 */
export function BootstrapProvider({ children }: { children: ReactNode }) {
    const { user, offline } = useAuth()
    const userId = user?.id ?? null
    const [loaded, setLoaded] = useState<Loaded>(EMPTY)
    const lastLoad = useRef<Promise<boolean> | null>(null)

    const load = useCallback(() => {
        const request = fetch(`${API}/bootstrap`, { credentials: "include" })
            .then(r => (r.ok ? r.json() as Promise<BootstrapCache> : null))
            .then(data => {
                if (!data || Object.keys(data).length === 0) return false
                setLoaded({ cache: data, savedAt: Date.now(), fresh: true })
                return true
            })
            .catch(() => false)
        lastLoad.current = request
        return request
    }, [])

    // App load: starts alongside /auth/me rather than after it.
    useEffect(() => { void load() }, [load])

    // A member who signs in after the app loaded (the load above was signed
    // out), or a different member, gets their own bootstrap.
    const lastUserId = useRef<string | null>(null)
    useEffect(() => {
        const previous = lastUserId.current
        lastUserId.current = userId
        if (userId === null) {
            if (previous !== null) setLoaded(EMPTY)
            return
        }
        if (offline || userId === previous) return
        if (previous !== null) {
            void load()
            return
        }
        void lastLoad.current?.then(ok => { if (!ok) void load() })
    }, [userId, offline, load])

    // Back online after running on saved info: fetch fresh data.
    const wasOffline = useRef(offline)
    useEffect(() => {
        if (wasOffline.current && !offline && userId) void load()
        wasOffline.current = offline
    }, [offline, userId, load])

    // Online with fresh data: keep the offline subset on the phone.
    useEffect(() => {
        if (loaded.fresh && userId && !offline && loaded.savedAt !== null) {
            saveOfflineSnapshot(userId, loaded.cache, loaded.savedAt)
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
            <BootstrapSavedAtContext.Provider value={value.savedAt}>
                {children}
            </BootstrapSavedAtContext.Provider>
        </BootstrapContext.Provider>
    )
}
