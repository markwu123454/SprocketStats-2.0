import { Link } from "react-router-dom"
import { ArrowLeft } from "lucide-react"

/**
 * Placeholder for the scouting page. Contents are still TBD — for now it just
 * renders a header and a way back to labeling progress inside the app shell.
 */
export default function ScoutingFormPage() {
    return (
        <div className="mx-auto px-4 py-8 flex flex-col gap-6 h-full">
            <div className="flex items-center gap-3">
                <Link
                    to="/scouting"
                    className="rounded-lg border p-1.5 transition-opacity hover:opacity-70 theme-border theme-subtext-color"
                    aria-label="Back to scouting"
                >
                    <ArrowLeft size={18} />
                </Link>
                <h1 className="text-2xl font-bold theme-h1-color">Scouting Page</h1>
            </div>
        </div>
    )
}
