import {lazy, type ReactNode, Suspense, useLayoutEffect} from "react"
import {BrowserRouter, Routes, Route} from "react-router-dom"
import "./index.css"
import ThemeProvider from "@/contexts/themeProvider.tsx"
import {AuthProvider} from "@/contexts/authContext.tsx"
import {AppReadyProvider} from "@/contexts/appReadyContext"

import AuthWrapper from "@/components/wrappers/AuthWrapper.tsx"
import ControlGuard from "@/components/wrappers/ControlGuard.tsx"
import PermGuard from "@/components/wrappers/PermGuard.tsx"

const LoginPageRouter      = lazy(() => import("@/pages/LoginPageRouter"))
const OnboardingPageRouter = lazy(() => import("@/pages/OnboardingPageRouter.tsx"))
const AppShell       = lazy(() => import("@/layouts/AppShell.tsx"))
const DashboardPage  = lazy(() => import("@/pages/DashboardPage.tsx"))
const AttendancePage    = lazy(() => import("@/pages/AttendancePage"))
const EventsPage    = lazy(() => import("@/pages/EventsPage"))
const ScoutingPage    = lazy(() => import("@/pages/ScoutingPage"))
const ControlPanelHub  = lazy(() => import("@/pages/control/ControlPanelHub"))
const MeetingPage       = lazy(() => import("@/pages/control/MeetingPage"))
const UpcomingEventPage = lazy(() => import("@/pages/control/UpcomingEventPage"))
const MembersPage       = lazy(() => import("@/pages/control/MembersPage"))
const NotificationsPage = lazy(() => import("@/pages/control/NotificationsPage"))
const NotificationDetailPage = lazy(() => import("@/pages/control/NotificationDetailPage"))
const PushNotificationsPage = lazy(() => import("@/pages/control/PushNotificationsPage"))
const SettingPage    = lazy(() => import("@/pages/SettingPage"))
const NotFoundPage   = lazy(() => import("@/pages/NotFoundPage"))

function Protected({children}: {children: ReactNode}) {
    return <AuthWrapper>{children}</AuthWrapper>
}

export default function App() {
    useLayoutEffect(() => {
        const setVh = () => {
            const h = window.visualViewport?.height ?? window.innerHeight
            document.documentElement.style.setProperty("--real-vh", `${h}px`)
        }
        setVh()
        window.visualViewport?.addEventListener("resize", setVh)
        window.addEventListener("resize", setVh)
        return () => {
            window.visualViewport?.removeEventListener("resize", setVh)
            window.removeEventListener("resize", setVh)
        }
    }, [])

    return (
        <ThemeProvider>
            <AuthProvider>
                <AppReadyProvider>
                    <BrowserRouter>
                        <div className="flex flex-col min-h-0" style={{ height: "var(--real-vh, 100dvh)" }}>
                            <Suspense fallback={null}>
                                <Routes>
                                    <Route path="/" element={<LoginPageRouter/>}/>
                                    <Route path="/onboarding" element={<OnboardingPageRouter/>}/>

                                    {/* One guard for the whole shell: AuthWrapper gates
                                        AppShell + every child page, so all of them are
                                        downstream of the signed-in + onboarded guarantee. */}
                                    <Route element={<Protected><AppShell/></Protected>}>
                                        <Route path="/dashboard"   element={<DashboardPage/>}/>
                                        <Route path="/attendance"  element={<PermGuard perm="attendance.view"><AttendancePage/></PermGuard>}/>
                                        <Route path="/events" element={<EventsPage/>}/>
                                        <Route path="/scouting"    element={<ScoutingPage/>}/>
                                        <Route path="/control"     element={<ControlPanelHub/>}/>
                                        <Route path="/control/meeting"        element={<ControlGuard section="meeting"><MeetingPage/></ControlGuard>}/>
                                        <Route path="/control/upcoming-event" element={<ControlGuard section="upcoming-event"><UpcomingEventPage/></ControlGuard>}/>
                                        <Route path="/control/members"        element={<ControlGuard section="members"><MembersPage/></ControlGuard>}/>
                                        <Route path="/control/notifications"  element={<ControlGuard section="notifications"><NotificationsPage/></ControlGuard>}/>
                                        <Route path="/control/notifications/new" element={<ControlGuard section="notifications"><NotificationDetailPage isNew/></ControlGuard>}/>
                                        <Route path="/control/notifications/:id" element={<ControlGuard section="notifications"><NotificationDetailPage/></ControlGuard>}/>
                                        <Route path="/control/push"           element={<ControlGuard section="push"><PushNotificationsPage/></ControlGuard>}/>
                                        <Route path="/settings"    element={<SettingPage/>}/>
                                    </Route>

                                    <Route path="*" element={<NotFoundPage/>}/>
                                </Routes>
                            </Suspense>
                        </div>
                    </BrowserRouter>
                </AppReadyProvider>
            </AuthProvider>
        </ThemeProvider>
    )
}
