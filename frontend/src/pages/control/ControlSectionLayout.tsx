import type { ReactNode } from "react"
import { typeH1 } from "@/lib/uiClasses"

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
    /** A 1200px frame with wider gutters from `md` up, for two-column pages. */
    wide?: boolean
    children?: ReactNode
}) {
    return (
        <div className={`${wide ? "max-w-[1200px] md:px-6" : "max-w-4xl"} mx-auto px-4 py-6 flex flex-col gap-6`}>
            <h1 className={`${typeH1} theme-h1-color`}>{title}</h1>
            {children}
        </div>
    )
}
