import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { ChevronLeft } from "lucide-react"

/**
 * Shared frame for a Control Panel sub-page.
 *
 * On mobile the sub-page is reached from the hub of cards, so it shows a back
 * arrow to `/control`. On desktop the sidebar accordion is always visible, so
 * the back link is hidden (`md:hidden`) — navigation lives in the sidebar.
 */
export default function ControlSectionLayout({
    title,
    children,
}: {
    title: string
    children?: ReactNode
}) {
    return (
        <div className="max-w-4xl mx-auto px-4 py-6 flex flex-col gap-6">
            <div className="flex items-center gap-2">
                <Link
                    to="/control"
                    aria-label="Back to Control Panel"
                    className="md:hidden flex items-center justify-center w-9 h-9 -ml-2 rounded-lg theme-text opacity-60 hover:opacity-100 transition-opacity"
                >
                    <ChevronLeft size={22} />
                </Link>
                <h1 className="text-2xl font-bold theme-h1-color">{title}</h1>
            </div>
            {children}
        </div>
    )
}
