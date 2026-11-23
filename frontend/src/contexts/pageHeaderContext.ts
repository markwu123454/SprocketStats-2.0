import { createContext, useContext, useLayoutEffect } from "react"

/**
 * The page title lives in the app's top bar, not in the page: each page names
 * itself with `usePageHeader` and AppShell draws it (a breadcrumb after the logo
 * on web, centred on phones). Pages keep no visible h1 of their own; the bar's
 * title is the h1.
 */
export interface PageHeader {
    title: string
    /** The parent page, for a nested page: a back arrow on phones, a breadcrumb link on web. */
    back?: { to: string; label: string }
    /** A short status next to the title, e.g. a notice's Active or Deactivated. */
    badge?: { label: string; tone: "accent" | "muted" }
}

type SetPageHeader = (header: PageHeader | null) => void

export const PageHeaderContext = createContext<SetPageHeader>(() => {})

/** Names the current page in the top bar while the calling component is mounted. */
export function usePageHeader(title: string, options: Omit<PageHeader, "title"> = {}) {
    const setHeader = useContext(PageHeaderContext)
    // Primitives only, so a fresh options object each render doesn't loop.
    const backTo = options.back?.to
    const backLabel = options.back?.label
    const badgeLabel = options.badge?.label
    const badgeTone = options.badge?.tone ?? "muted"

    useLayoutEffect(() => {
        setHeader({
            title,
            back: backTo && backLabel ? { to: backTo, label: backLabel } : undefined,
            badge: badgeLabel ? { label: badgeLabel, tone: badgeTone } : undefined,
        })
    }, [setHeader, title, backTo, backLabel, badgeLabel, badgeTone])

    useLayoutEffect(() => () => setHeader(null), [setHeader])
}
