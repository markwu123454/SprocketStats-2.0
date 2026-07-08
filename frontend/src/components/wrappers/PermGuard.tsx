import type { ReactNode } from "react"
import { Navigate } from "react-router-dom"
import { useOnboardedUser } from "@/contexts/authContext.tsx"
import { can } from "@/lib/permissions"

/**
 * Capability gate for a top-level page.
 *
 * Reads the current user's resolved policy and requires a single boolean
 * capability at `perm` (a dotted path, e.g. "attendance.view"). If the policy
 * doesn't grant it — including someone following a deep-link to a page their
 * role can't see — bounce to `redirectTo` (default /dashboard) rather than
 * render the page. Runs downstream of AuthWrapper, so the user is guaranteed
 * present + onboarded. Gating here is cosmetic; real enforcement is per-endpoint.
 */
export default function PermGuard({
    perm,
    children,
    redirectTo = "/dashboard",
}: {
    perm: string
    children: ReactNode
    redirectTo?: string
}) {
    const user = useOnboardedUser()
    if (!can(user.permissions, perm)) return <Navigate to={redirectTo} replace />
    return <>{children}</>
}
