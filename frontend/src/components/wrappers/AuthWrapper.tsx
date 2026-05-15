import {useEffect} from "react"
import {useNavigate} from "react-router-dom"
import {useAuth} from "@/contexts/authContext.tsx"

export default function AuthWrapper({children}: { children: React.ReactNode }) {
    const {user, loading} = useAuth()
    const navigate = useNavigate()

    useEffect(() => {
        if (!loading && !user) navigate("/", {replace: true})
    }, [user, loading, navigate])

    if (loading) return null
    if (!user) return null

    return <>{children}</>
}