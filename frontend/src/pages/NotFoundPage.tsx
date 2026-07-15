import { Link } from "react-router-dom"
import { Compass } from "lucide-react"
import {useAppReady} from "@/contexts/appReadyContext";
import {useEffect} from "react";

// Nested catch-all inside the Protected/AppShell route in App.tsx, so it only
// ever renders for authenticated users (a logged-out visitor hitting the same
// splat gets redirected to login by AuthWrapper before this mounts).
export default function NotFoundPage() {
    const markReady = useAppReady()

    useEffect(() => { markReady() }, [markReady])

    return (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-4 py-16 text-center">
            <div
                className="flex items-center justify-center w-16 h-16 rounded-full border theme-border theme-bg"
            >
                <Compass size={28} className="theme-text-contrast opacity-70" />
            </div>

            <h1 className="text-5xl font-bold theme-h1-color">404</h1>
            <p className="text-base font-medium theme-text">Page not found</p>
            <p className="text-sm theme-subtext-color max-w-xs">
                The page you're looking for doesn't exist or may have been moved.
            </p>

            <Link
                to="/dashboard"
                className="mt-2 inline-flex items-center theme-text-contrast theme-bg gap-1 font-bold rounded-lg px-4 py-2.5 text-sm transition-opacity hover:opacity-90"
            >
                Back to dashboard
            </Link>
        </div>
    )
}
