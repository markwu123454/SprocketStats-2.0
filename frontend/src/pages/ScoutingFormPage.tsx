import { Link } from "react-router-dom"
import { ArrowLeft } from "lucide-react"
import { buttonClass } from "@/lib/uiClasses"

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
                    className={buttonClass({ variant: "icon", className: "border theme-border" })}
                    aria-label="Back to scouting"
                >
                    <ArrowLeft size={18} />
                </Link>
                <h1 className="text-2xl font-bold theme-h1-color">Scouting Page</h1>
            </div>
        </div>
    )
}
