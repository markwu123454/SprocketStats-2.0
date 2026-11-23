import { useEffect } from "react"
import TaskLeaderboard from "@/components/TaskLeaderboard"
import AttendanceLeaderboard from "@/components/AttendanceLeaderboard"
import { useAppReady } from "@/contexts/appReadyContext"
import { usePageHeader } from "@/contexts/pageHeaderContext"

export default function LeaderboardsPage() {
    const markReady = useAppReady()
    usePageHeader("Leaderboards")
    useEffect(() => { markReady() }, [markReady])

    return (
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-8 flex flex-col gap-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                <AttendanceLeaderboard />
                <TaskLeaderboard />
            </div>
        </div>
    )
}
