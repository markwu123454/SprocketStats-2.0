import {lazy, type ReactNode, Suspense, useLayoutEffect} from "react"
import {BrowserRouter, Routes, Route} from "react-router-dom"
import "./index.css"
import ThemeProvider from "@/contexts/themeProvider.tsx"
import {AuthProvider} from "@/contexts/authContext.tsx"
import {AppReadyProvider} from "@/contexts/appReadyContext"

import AuthWrapper from "@/components/wrappers/AuthWrapper.tsx"

const LoginPageRouter      = lazy(() => import("@/pages/LoginPageRouter"))
const OnboardingPageRouter = lazy(() => import("@/pages/OnboardingPageRouter.tsx"))
const AppShell       = lazy(() => import("@/layouts/AppShell.tsx"))
const DashboardPage  = lazy(() => import("@/pages/DashboardPage.tsx"))
const AttendancePage    = lazy(() => import("@/pages/AttendancePage"))
const CompetitionPage    = lazy(() => import("@/pages/CompetitionPage"))
const ScoutingPage    = lazy(() => import("@/pages/ScoutingPage"))
const ControlPanelPage    = lazy(() => import("@/pages/ControlPanelPage"))
const SettingPage    = lazy(() => import("@/pages/SettingPage"))

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
                                        <Route path="/attendance"  element={<AttendancePage/>}/>
                                        <Route path="/competition" element={<CompetitionPage/>}/>
                                        <Route path="/scouting"    element={<ScoutingPage/>}/>
                                        <Route path="/control"     element={<ControlPanelPage/>}/>
                                        <Route path="/settings"    element={<SettingPage/>}/>
                                    </Route>
                                </Routes>
                            </Suspense>
                        </div>
                    </BrowserRouter>
                </AppReadyProvider>
            </AuthProvider>
        </ThemeProvider>
    )
}