import {lazy, type ReactNode, Suspense, useLayoutEffect} from "react"
import {BrowserRouter, Routes, Route} from "react-router-dom"
import "./index.css"
import ThemeProvider from "@/contexts/themeProvider.tsx"
import {AuthProvider} from "@/contexts/AuthProvider"
import {AppReadyProvider} from "@/contexts/AppReadyProvider"
import {BootstrapProvider} from "@/contexts/BootstrapProvider"

import AuthWrapper from "@/components/wrappers/AuthWrapper.tsx"
import ControlGuard from "@/components/wrappers/ControlGuard.tsx"
import PermGuard from "@/components/wrappers/PermGuard.tsx"

const LoginPageRouter      = lazy(() => import("@/pages/LoginPageRouter"))
const OnboardingPageRouter = lazy(() => import("@/pages/OnboardingPageRouter.tsx"))
const AppShell       = lazy(() => import("@/layouts/AppShell.tsx"))
const DashboardPage  = lazy(() => import("@/pages/DashboardPage.tsx"))
const AttendancePage    = lazy(() => import("@/pages/AttendancePage"))
const EventsPage         = lazy(() => import("@/pages/EventsPage"))
const EventShell         = lazy(() => import("@/pages/events/EventShell"))
const EventHubPage       = lazy(() => import("@/pages/events/EventHubPage"))
const ItineraryPage      = lazy(() => import("@/pages/events/ItineraryPage"))
const PackingPage        = lazy(() => import("@/pages/events/PackingPage"))
const RosterPage         = lazy(() => import("@/pages/events/RosterPage"))
const CompPage           = lazy(() => import("@/pages/events/CompPage"))
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
const PrivacyPage    = lazy(() => import("@/pages/PrivacyPage"))
const TermsPage      = lazy(() => import("@/pages/TermsPage"))

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
                    <BootstrapProvider>
                    <BrowserRouter>
                        <div className="flex flex-col min-h-0" style={{ height: "var(--real-vh, 100dvh)" }}>
                            <Suspense fallback={null}>
                                <Routes>
                                    <Route path="/" element={<LoginPageRouter/>}/>
                                    <Route path="/onboarding" element={<OnboardingPageRouter/>}/>
                                    <Route path="/privacy" element={<PrivacyPage/>}/>
                                    <Route path="/terms" element={<TermsPage/>}/>

                                    {/* One guard for the whole shell: AuthWrapper gates
                                        AppShell + every child page, so all of them are
                                        downstream of the signed-in + onboarded guarantee. */}
                                    <Route element={<Protected><AppShell/></Protected>}>
                                        <Route path="/dashboard"   element={<DashboardPage/>}/>
                                        <Route path="/attendance"  element={<PermGuard perm="attendance.view"><AttendancePage/></PermGuard>}/>
                                        <Route path="/events" element={<EventsPage/>}/>
                                        <Route path="/events/:eventKey" element={<EventShell/>}>
                                            <Route index element={<EventHubPage/>}/>
                                            <Route path="itinerary" element={<ItineraryPage/>}/>
                                            <Route path="packing"   element={<PackingPage/>}/>
                                            <Route path="roster"    element={<RosterPage/>}/>
                                            <Route path="comp"      element={<CompPage/>}/>
                                        </Route>
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

                                        {/* Catches any authenticated dead-end not matched above.
                                            A logged-out visitor hitting the same URL never reaches
                                            this — AuthWrapper redirects to "/" before it mounts. */}
                                        <Route path="*" element={<NotFoundPage/>}/>
                                    </Route>
                                </Routes>
                            </Suspense>
                        </div>
                    </BrowserRouter>
                    </BootstrapProvider>
                </AppReadyProvider>
            </AuthProvider>
        </ThemeProvider>
    )
}
