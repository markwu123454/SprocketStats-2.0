import type { ReactNode } from "react"
import { usePageHeader } from "@/contexts/pageHeaderContext"

/**
 * Shared frame for a Control Panel sub-page.
 *
 * No back link: these are top-level pages, reached from the desktop sidebar or
 * the mobile More sheet, and both stay one tap away.
 */
export default function ControlSectionLayout({
    title,
    wide = false,
    children,
}: {
    title: string
    /** Full width with wider gutters from `md` up, for two-column pages. */
    wide?: boolean
    children?: ReactNode
}) {
    // The title shows in the app's top bar, not in the page.
    usePageHeader(title)
    return (
        <div className={`${wide ? "md:px-6" : "max-w-4xl mx-auto"} px-4 py-6 flex flex-col gap-6`}>
            {children}
        </div>
    )
}
