import type { ReactNode } from "react"
import { Navigate } from "react-router-dom"
import { useIsOffline, useOnboardedUser } from "@/contexts/authContext"
import { OfflineUnavailable } from "@/components/Offline"
import { CONTROL_SECTIONS, visibleSections } from "@/lib/controlSections"

/**
 * Permission gate for the Control Panel routes.
 *
 * With a `section`, looks it up by route segment and applies the same `visible`
 * predicate the desktop sidebar and the mobile More sheet use, so entry rules
 * never drift from what's shown. `/control` itself has no page: mounted there
 * without a `section`, this opens the first section the role can see.
 *
 * An unknown section, or one the user's policy can't see (e.g. a shared
 * deep-link), also goes to that first section, and a role with none goes to the
 * dashboard. Runs downstream of AuthWrapper, so the user is guaranteed present
 * + onboarded; the backend still enforces each action.
 */
export default function ControlGuard({ section, children }: { section?: string; children?: ReactNode }) {
    const user = useOnboardedUser()
    const offline = useIsOffline()
    const match = section ? CONTROL_SECTIONS.find(s => s.to === section) : undefined
    if (!match || !match.visible(user.permissions)) {
        const first = visibleSections(user.permissions)[0]
        return <Navigate to={first ? `/control/${first.to}` : "/dashboard"} replace />
    }
    // Control Panel data is never saved on the phone (lib/offline.ts).
    if (offline) return <OfflineUnavailable what="The Control Panel" />
    return <>{children}</>
}
