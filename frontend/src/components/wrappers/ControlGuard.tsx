import type { ReactNode } from "react"
import { Navigate } from "react-router-dom"
import { useOnboardedUser } from "@/contexts/authContext.tsx"
import { CONTROL_SECTIONS } from "@/lib/controlSections"

/**
 * Permission gate for a Control Panel sub-route.
 *
 * Looks the section up by its route segment and applies the same `visible`
 * predicate the sidebar/hub use, so entry rules never drift from what's shown.
 * If the section is unknown or the user's policy can't see it (e.g. a shared
 * deep-link they lack access to), bounce to the Control Panel index rather than
 * render a blank page. Runs downstream of AuthWrapper, so the user is guaranteed
 * present + onboarded; the backend still enforces each action.
 */
export default function ControlGuard({ section, children }: { section: string; children: ReactNode }) {
    const user = useOnboardedUser()
    const match = CONTROL_SECTIONS.find(s => s.to === section)
    if (!match || !match.visible(user.permissions)) return <Navigate to="/control" replace />
    return <>{children}</>
}
