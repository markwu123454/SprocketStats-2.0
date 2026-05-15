import {lazy, Suspense} from "react"
import {BrowserRouter, Routes, Route} from "react-router-dom"
import "./index.css"
import ThemeProvider from "@/contexts/themeProvider.tsx"

import AuthWrapper from "@/components/wrappers/AuthWrapper.tsx"

// Lazy imports — each page becomes its own chunk
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage.tsx"))


// Shared fallback — swap this out for a spinner if you want
const PageFallback = () => (
    <div className="h-full flex items-center justify-center text-muted-foreground">
        Loading...
    </div>
)

export default function App() {
    return (
        <ThemeProvider>
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
        </ThemeProvider>
    )
}