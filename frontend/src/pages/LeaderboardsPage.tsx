import { useEffect } from "react"
import TaskLeaderboard from "@/components/TaskLeaderboard"
import AttendanceLeaderboard from "@/components/AttendanceLeaderboard"
import { useAppReady } from "@/contexts/appReadyContext"

export default function LeaderboardsPage() {
    const markReady = useAppReady()
    useEffect(() => { markReady() }, [markReady])

    return (
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-8 flex flex-col gap-4">
            <div>
                <h1 className="text-2xl font-bold theme-h1-color">Leaderboards</h1>
                <p className="text-sm theme-subtext-color mt-1">Who's putting in the work, in hours and in tasks.</p>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                <AttendanceLeaderboard />
                <TaskLeaderboard />
            </div>
        </div>
    )
}
