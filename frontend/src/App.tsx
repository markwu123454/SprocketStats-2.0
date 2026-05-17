import {lazy, Suspense} from "react"
import {BrowserRouter, Routes, Route} from "react-router-dom"
import "./index.css"
import ThemeProvider from "@/contexts/themeProvider.tsx"
import {AuthProvider} from "@/contexts/authContext.tsx"
import {AppReadyProvider} from "@/contexts/appReadyContext"

import AuthWrapper from "@/components/wrappers/AuthWrapper.tsx"

const LoginPage = lazy(() => import("@/pages/LoginPage.tsx"))
const DashboardPage = lazy(() => import("@/pages/DashboardPage.tsx"))
const AppShell = lazy(() => import("@/layouts/AppShell.tsx"))


export default function App() {
    return (
        <ThemeProvider>
            <AuthProvider>
                <AppReadyProvider>
                    <BrowserRouter>
                        <div className="h-screen flex flex-col min-h-0">
                            <Suspense fallback={null}>
                                <Routes>
                                    <Route path="/" element={<LoginPage/>}/>

                                    <Route element={<AppShell/>}>
                                        <Route path="/dashboard" element={
                                            <AuthWrapper>
                                                <DashboardPage/>
                                            </AuthWrapper>
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