import {lazy, Suspense, useLayoutEffect} from "react"
import {BrowserRouter, Routes, Route} from "react-router-dom"
import "./index.css"
import ThemeProvider from "@/contexts/themeProvider.tsx"
import {AuthProvider} from "@/contexts/authContext.tsx"
import {AppReadyProvider} from "@/contexts/appReadyContext"

import AuthWrapper from "@/components/wrappers/AuthWrapper.tsx"

const LoginPage      = lazy(() => import("@/pages/LoginPage.tsx"))
const OnboardingPage = lazy(() => import("@/pages/OnboardingPage.tsx"))
const AppShell       = lazy(() => import("@/layouts/AppShell.tsx"))
const DashboardPage  = lazy(() => import("@/pages/DashboardPage.tsx"))
const AttendancePage    = lazy(() => import("@/pages/AttendancePage"))
const CompetitionPage    = lazy(() => import("@/pages/CompetitionPage"))
const ScoutingPage    = lazy(() => import("@/pages/ScoutingPage"))
const SettingPage    = lazy(() => import("@/pages/SettingPage"))

function Protected({children}: {children: React.ReactNode}) {
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
                                    <Route path="/" element={<LoginPage/>}/>
                                    <Route path="/onboarding" element={<OnboardingPage/>}/>

                                    <Route element={<AppShell/>}>
                                        <Route path="/dashboard" element={
                                            <Protected><DashboardPage/></Protected>
                                        }/>
                                        <Route path="/attendance" element={
                                            <Protected><AttendancePage/></Protected>
                                        }/>
                                        <Route path="/competition" element={
                                            <Protected><CompetitionPage/></Protected>
                                        }/>
                                        <Route path="/scouting" element={
                                            <Protected><ScoutingPage/></Protected>
                                        }/>
                                        <Route path="/settings" element={
                                            <Protected><SettingPage/></Protected>
                                        }/>
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