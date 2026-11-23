import { type RefObject, useEffect, useRef } from "react"
import { serverClockOffset } from "@/lib/boardApi"

const RESYNC_MS = 10 * 60_000
const RETRY_MS = 10_000

/** How far this device's clock is behind the server's, in ms, kept current for
 *  a screen that stays up all day; null until the first answer. */
export function useServerClock(): RefObject<number | null> {
    const offset = useRef<number | null>(null)
    useEffect(() => {
        let cancelled = false
        let timer = 0
        const sync = async () => {
            try {
                const value = await serverClockOffset()
                if (cancelled) return
                offset.current = value
                timer = window.setTimeout(() => void sync(), RESYNC_MS)
            } catch {
                if (!cancelled) timer = window.setTimeout(() => void sync(), RETRY_MS)
            }
        }
        void sync()
        return () => {
            cancelled = true
            window.clearTimeout(timer)
        }
    }, [])
    return offset
}
