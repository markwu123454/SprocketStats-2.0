import {lazy, type ReactNode, Suspense, useLayoutEffect} from "react"
import {BrowserRouter, Navigate, Routes, Route} from "react-router-dom"
import "./index.css"
import ThemeProvider from "@/contexts/themeProvider.tsx"
import {AuthProvider} from "@/contexts/AuthProvider"
import {AppReadyProvider} from "@/contexts/AppReadyProvider"
import {BootstrapProvider} from "@/contexts/BootstrapProvider"

import AuthWrapper from "@/components/wrappers/AuthWrapper.tsx"
import ControlGuard from "@/components/wrappers/ControlGuard.tsx"
import PermGuard from "@/components/wrappers/PermGuard.tsx"
import UpdatePrompt from "@/components/UpdatePrompt.tsx"
import ConfirmHost from "@/components/ui/ConfirmDialog"
import PageErrorBoundary from "@/components/ErrorBoundary"
import {watchViewport} from "@/lib/viewport"

const LoginPageRouter      = lazy(() => import("@/pages/LoginPageRouter"))
const OnboardingPageRouter = lazy(() => import("@/pages/OnboardingPageRouter.tsx"))
const AppShell       = lazy(() => import("@/layouts/AppShell.tsx"))
const DashboardPage  = lazy(() => import("@/pages/DashboardPage.tsx"))
const MeetingsPage    = lazy(() => import("@/pages/MeetingsPage"))
const EventsPage         = lazy(() => import("@/pages/EventsPage"))
const EventShell         = lazy(() => import("@/pages/events/EventShell"))
const EventHubPage       = lazy(() => import("@/pages/events/EventHubPage"))
const ItineraryPage      = lazy(() => import("@/pages/events/ItineraryPage"))
const PackingPage        = lazy(() => import("@/pages/events/PackingPage"))
const RosterPage         = lazy(() => import("@/pages/events/RosterPage"))
const CompPage           = lazy(() => import("@/pages/events/CompPage"))
const EventTasksPage     = lazy(() => import("@/pages/events/EventTasksPage"))
const LeaderboardsPage = lazy(() => import("@/pages/LeaderboardsPage"))
const CheckinPage      = lazy(() => import("@/pages/CheckinPage"))
const ScoutingPage    = lazy(() => import("@/pages/ScoutingPage"))
const ScoutingFormPage = lazy(() => import("@/pages/ScoutingFormPage"))
const TasksPage       = lazy(() => import("@/pages/TasksPageRouter"))
const MeetingPage       = lazy(() => import("@/pages/control/MeetingPage"))
const UpcomingEventPage = lazy(() => import("@/pages/control/UpcomingEventPage"))
const MembersPage       = lazy(() => import("@/pages/control/MembersPage"))
const ControlAttendancePage = lazy(() => import("@/pages/control/AttendancePage"))
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
    // --app-vh, --real-vh and --vv-top: the page's height and the on-screen part of it (lib/viewport.ts).
    useLayoutEffect(() => watchViewport(), [])

    return (
        <ThemeProvider>
            <AuthProvider>
                <AppReadyProvider>
                    <BootstrapProvider>
                    <BrowserRouter>
                        <div className="flex flex-col min-h-0" style={{ height: "var(--app-vh, 100dvh)" }}>
                            <PageErrorBoundary>
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
                                        <Route path="/meetings" element={<MeetingsPage/>}/>
                                        <Route path="/attendance" element={<Navigate to="/meetings" replace/>}/>
                                        <Route path="/events" element={<EventsPage/>}/>
                                        {/* Pages a role can't see bounce to the dashboard; the
                                            server refuses their data either way. */}
                                        <Route path="/events/:eventKey" element={<PermGuard perm="events.details"><EventShell/></PermGuard>}>
                                            <Route index element={<EventHubPage/>}/>
                                            <Route path="itinerary" element={<ItineraryPage/>}/>
                                            <Route path="packing"   element={<PackingPage/>}/>
                                            <Route path="roster"    element={<RosterPage/>}/>
                                            <Route path="tasks"     element={<EventTasksPage/>}/>
                                            <Route path="comp"      element={<CompPage/>}/>
                                        </Route>
                                        <Route path="/leaderboards" element={<PermGuard perm="leaderboards.view"><LeaderboardsPage/></PermGuard>}/>
                                        <Route path="/checkin"     element={<CheckinPage/>}/>
                                        {/* The old mobile Other page; its links now live in the More sheet. */}
                                        <Route path="/other"       element={<Navigate to="/dashboard" replace/>}/>
                                        <Route path="/scouting"    element={<PermGuard perm="scouting.view"><ScoutingPage/></PermGuard>}/>
                                        <Route path="/scouting/scout" element={<PermGuard perm="scouting.view"><ScoutingFormPage/></PermGuard>}/>
                                        <Route path="/tasks"       element={<PermGuard perm="tasks.view"><TasksPage/></PermGuard>}/>
                                        {/* No page of its own: opens the first section this role can see. */}
                                        <Route path="/control"     element={<ControlGuard/>}/>
                                        <Route path="/control/meeting"        element={<ControlGuard section="meeting"><MeetingPage/></ControlGuard>}/>
                                        <Route path="/control/upcoming-event" element={<ControlGuard section="upcoming-event"><UpcomingEventPage/></ControlGuard>}/>
                                        <Route path="/control/members"        element={<ControlGuard section="members"><MembersPage/></ControlGuard>}/>
                                        <Route path="/control/attendance"     element={<ControlGuard section="attendance"><ControlAttendancePage/></ControlGuard>}/>
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
                            </PageErrorBoundary>
                            <UpdatePrompt/>
                            <ConfirmHost/>
                        </div>
                    </BrowserRouter>
                    </BootstrapProvider>
                </AppReadyProvider>
            </AuthProvider>
        </ThemeProvider>
    )
}
