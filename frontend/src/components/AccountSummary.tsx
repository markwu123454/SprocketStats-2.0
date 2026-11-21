import { useOnboardedUser } from "@/contexts/authContext"
import { getPerm } from "@/lib/permissions"

/**
 * The signed-in member's name, email and role, as both account menus show them
 * (the desktop dropdown and the mobile More sheet).
 */
export default function AccountSummary({ className = "" }: { className?: string }) {
    const user = useOnboardedUser()
    // The human-readable role label comes from the backend policy; fall back to
    // the raw role slug if the role isn't in the policy map.
    const roleLabel = (getPerm(user.permissions, "label") as string | undefined) ?? user.role

    return (
        <div className={`min-w-0 ${className}`.trim()}>
            <p className="text-sm font-semibold theme-text truncate">{user.display_name}</p>
            <p className="text-xs theme-subtext-color truncate">{user.email}</p>
            <p className="text-xs theme-text-contrast truncate mt-0.5">{roleLabel}</p>
        </div>
    )
}
