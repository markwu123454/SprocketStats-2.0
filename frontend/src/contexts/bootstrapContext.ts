import { createContext, type Dispatch, type SetStateAction, useCallback, useContext, useEffect, useRef, useState } from "react"

// Context + hook live here (no components) following the same pattern as
// appReadyContext.ts and authContext.ts — provider lives in BootstrapProvider.tsx.

export type BootstrapCache = Record<string, unknown>

export const BootstrapContext = createContext<BootstrapCache>({})

/**
 * The newest value a page has had for each bootstrap key this session: its own
 * fetch, or a change it made. The next page that mounts with that key starts
 * from it rather than the /bootstrap snapshot from app load, so renavigating
 * never flashes data older than what was last on screen. BootstrapProvider
 * empties it whenever a fresh /bootstrap arrives, which is newer still.
 */
export interface BootstrapLatest {
    has: (key: string) => boolean
    get: (key: string) => unknown
    set: (key: string, value: unknown) => void
}

/**
 * A store of newest values. `onSet` hears every value recorded (the provider
 * saves them for offline use). Outside a provider (tests), a store of its own.
 */
export function createBootstrapLatest(onSet?: (key: string, value: unknown) => void): BootstrapLatest & { clear: () => void } {
    let values: BootstrapCache = {}
    return {
        has: key => key in values,
        get: key => values[key],
        set: (key, value) => {
            values[key] = value
            onSet?.(key, value)
        },
        clear: () => { values = {} },
    }
}

export const BootstrapLatestContext = createContext<BootstrapLatest>(createBootstrapLatest())

/** When the bootstrap data on screen was fetched (ms), or null before it arrives. Offline, that's when it was saved. */
export const BootstrapSavedAtContext = createContext<number | null>(null)

export function useBootstrapSavedAt(): number | null {
    return useContext(BootstrapSavedAtContext)
}

/**
 * Drop-in replacement for useState that pre-populates from the bootstrap cache.
 *
 * Behaves identically to useState(initialValue) — same [value, setter] return,
 * same setter contract. The only difference is the initial value: the newest
 * value any page has had for this key this session (BootstrapLatestContext),
 * else the bootstrap cache, so pages render with data immediately instead of
 * waiting for their own fetch.
 *
 * Pages keep their existing useEffect fetch unchanged. When it resolves it calls
 * the setter as normal, overwriting the seeded value with fresh data, and that
 * becomes what the next page with this key starts from. The returned setter is
 * stable and marks the value as touched, so a bootstrap that arrives later never
 * clobbers it.
 *
 * Every page that writes a key must write the same shape /bootstrap returns
 * for it (the endpoint's response), since they share the newest value.
 *
 * @param key    The key in the /bootstrap response to read from.
 * @param initialValue  Fallback used when the key isn't in the cache yet —
 *               identical to the argument you'd pass to useState().
 */
export function useBootstrapped<T>(
    key: string,
    initialValue: T,
): [T, Dispatch<SetStateAction<T>>] {
    const cache = useContext(BootstrapContext)
    const latest = useContext(BootstrapLatestContext)
    const [data, setData] = useState<T>(() =>
        latest.has(key) ? latest.get(key) as T : key in cache ? cache[key] as T : initialValue)
    // Set once the page itself has written a value (its own fetch resolved,
    // an optimistic update, ...). From then on the late-arriving bootstrap
    // cache must not overwrite it with older data.
    const touched = useRef(false)

    const setTouched = useCallback<Dispatch<SetStateAction<T>>>(value => {
        touched.current = true
        setData(value)
    }, [])

    // Keep what this page has now as the newest value for the next page with this key.
    useEffect(() => {
        if (touched.current) latest.set(key, data)
    }, [latest, key, data])

    // If bootstrap resolves after this component mounted (slow connection),
    // sync the value in -- unless the page has already written its own.
    useEffect(() => {
        if (touched.current) return
        if (latest.has(key)) setData(latest.get(key) as T)
        else if (key in cache) setData(cache[key] as T)
    }, [cache, latest, key])

    return [data, setTouched]
}
