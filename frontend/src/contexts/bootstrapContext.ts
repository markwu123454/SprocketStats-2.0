import { createContext, type Dispatch, type SetStateAction, useContext, useEffect, useState } from "react"

// Context + hook live here (no components) following the same pattern as
// appReadyContext.ts and authContext.ts — provider lives in BootstrapProvider.tsx.

export type BootstrapCache = Record<string, unknown>

export const BootstrapContext = createContext<BootstrapCache>({})

/**
 * Drop-in replacement for useState that pre-populates from the bootstrap cache.
 *
 * Behaves identically to useState(initialValue) — same [value, setter] return,
 * same setter contract. The only difference is the initial value comes from the
 * bootstrap cache if the key is present, so pages render with data immediately
 * instead of waiting for their own fetch.
 *
 * Pages keep their existing useEffect fetch unchanged. When it resolves it calls
 * the setter as normal, overwriting the bootstrap value with fresh data.
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
    const [data, setData] = useState<T>(() => key in cache ? cache[key] as T : initialValue)

    // If bootstrap resolves after this component mounted (slow connection),
    // sync the value in. Once the page's own fetch calls setData, that wins.
    useEffect(() => {
        if (key in cache) setData(cache[key] as T)
    }, [cache, key])

    return [data, setData]
}
