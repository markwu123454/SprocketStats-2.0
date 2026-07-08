import { useEffect, useState } from "react"

/** Tailwind's `md` breakpoint — below this we render the mobile layout. */
const MOBILE_MAX = 768

/**
 * Track whether the viewport is below the `md` breakpoint.
 *
 * Shared so the login/onboarding routers and the Control Panel all agree on the
 * same cutoff the CSS (`md:` classes) uses, instead of each re-deriving it.
 */
export function useIsMobile(): boolean {
    const [isMobile, setIsMobile] = useState(() => window.innerWidth < MOBILE_MAX)

    useEffect(() => {
        const handler = () => setIsMobile(window.innerWidth < MOBILE_MAX)
        window.addEventListener("resize", handler)
        return () => window.removeEventListener("resize", handler)
    }, [])

    return isMobile
}
