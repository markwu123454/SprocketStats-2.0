import { useIsMobile } from "@/lib/useIsMobile"
import TasksPageDesktop from "./TasksPageDesktop"
import TasksPageMobile from "./TasksPageMobile"

export type { TasksPageState } from "@/lib/taskFormat"

/** Picks the mobile or desktop task board, mirroring `LoginPageRouter`'s
 *  `useIsMobile()` split. */
export default function TasksPageRouter() {
    const isMobile = useIsMobile()
    return isMobile ? <TasksPageMobile /> : <TasksPageDesktop />
}
