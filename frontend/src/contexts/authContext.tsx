import {createContext, useCallback, useContext, useEffect, useState} from "react"

interface User {
    id: string
    email: string
    name?: string
    given_name?: string
    picture?: string
    display_name?: string
    role?: string
    grade?: string
    team_year?: string
    onboarding_complete?: boolean
}

interface AuthContextValue {
    user: User | null
    loading: boolean
    signInWithGoogle: () => void
    logout: () => Promise<void>
    refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const API = import.meta.env.VITE_BACKEND_URL

export function AuthProvider({children}: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null)
    const [loading, setLoading] = useState(true)

    const fetchUser = useCallback(async () => {
        const data = await fetch(`${API}/auth/me`, {credentials: "include"})
            .then((r) => (r.ok ? r.json() : null))
        setUser(data)
    }, [])

    useEffect(() => {
        fetchUser().finally(() => setLoading(false))
    }, [fetchUser])

    const signInWithGoogle = useCallback(() => {
        window.location.href = `${API}/auth/login`
    }, [])

    const logout = useCallback(async () => {
        await fetch(`${API}/auth/logout`, {method: "POST", credentials: "include"})
        setUser(null)
    }, [])

    const refreshUser = useCallback(async () => {
        await fetchUser()
    }, [fetchUser])

    return (
        <AuthContext.Provider value={{user, loading, signInWithGoogle, logout, refreshUser}}>
            {children}
        </AuthContext.Provider>
    )
}

export function useAuth() {
    const ctx = useContext(AuthContext)
    if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>")
    return ctx
}