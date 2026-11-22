// Small pieces both Members roster views draw (MembersGrid on desktop, MembersList on a phone).

import Avatar from "@/components/Avatar"
import Skeleton from "@/components/ui/Skeleton"
import { initials } from "@/lib/members"

export function MemberAvatar({ name, picture, size = 32 }: { name: string; picture: string | null; size?: number }) {
    return (
        <Avatar
            name={name}
            picture={picture}
            size={size}
            monogram={initials(name)}
            monogramStyle={{ background: "var(--theme-button-hover)", color: "var(--theme-h1-color)", fontSize: 12 }}
        />
    )
}

export function LeadBadge() {
    return (
        <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full border shrink-0 theme-text-contrast"
              style={{ borderColor: "var(--theme-text-contrast)" }}>
            LEAD
        </span>
    )
}

export function MembersSkeleton() {
    return (
        <div className="flex flex-col gap-3 px-4 md:px-6 py-4" role="status" aria-label="Loading members">
            {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
    )
}
