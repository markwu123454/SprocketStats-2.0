import {useEffect} from "react"
import {useNavigate} from "react-router-dom"
import {useAuth} from "@/contexts/authContext.tsx"

export default function AuthWrapper({children}: { children: React.ReactNode }) {
    const {user, loading} = useAuth()
    const navigate = useNavigate()

    useEffect(() => {
        if (!loading) {
            if (!user) {
                navigate("/", {replace: true})
            } else if (!user.onboarding_complete) {
                navigate("/onboarding", {replace: true})
            }
        }
    }, [user, loading, navigate])

    if (loading) return null
    if (!user || !user.onboarding_complete) return null

    return <>{children}</>
}