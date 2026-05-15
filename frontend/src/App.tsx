import {lazy, Suspense} from "react"
import {BrowserRouter, Routes, Route} from "react-router-dom"
import "./index.css"
import ThemeProvider from "@/contexts/themeProvider.tsx"
import {AuthProvider} from "@/contexts/authContext.tsx"

import AuthWrapper from "@/components/wrappers/AuthWrapper.tsx"

const NotFoundPage = lazy(() => import("@/pages/NotFoundPage.tsx"))
const LoginPage = lazy(() => import("@/pages/LoginPage.tsx"))
const DashboardPage = lazy(() => import("@/pages/DashboardPage.tsx"))
const AppShell = lazy(() => import("@/layouts/AppShell.tsx"))

const PageFallback = () => (
    <div className="h-full flex items-center justify-center text-muted-foreground">
        Loading...
    </div>
)

export default function App() {
    return (
        <ThemeProvider>
            <AuthProvider>
                <BrowserRouter>
                    <div className="h-screen flex flex-col min-h-0">
                        <Suspense fallback={<PageFallback/>}>
                            <Routes>
                                <Route path="/" element={<LoginPage/>}/>

                                <Route element={<AppShell/>}>
                                    <Route path="/dashboard" element={
                                        <AuthWrapper member mode="optimistic">
                                            <DashboardPage/>
                                        </AuthWrapper>
                                    }/>
                                </Route>

                                <Route path="*" element={<NotFoundPage/>}/>
                            </Routes>
                        </Suspense>
                    </div>
                </BrowserRouter>
            </AuthProvider>
        </ThemeProvider>
    )
}