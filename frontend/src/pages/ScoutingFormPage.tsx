import { usePageHeader } from "@/contexts/pageHeaderContext"

/**
 * Placeholder for the scouting page. Contents are still TBD — for now it just
 * names itself in the top bar, whose back arrow returns to labeling progress.
 */
export default function ScoutingFormPage() {
    usePageHeader("Scouting form", { back: { to: "/scouting", label: "Scouting" } })
    return <div className="mx-auto px-4 py-8 flex flex-col gap-6 h-full" />
}
