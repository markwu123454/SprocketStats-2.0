import {createContext, useCallback, useContext, useEffect, useState} from "react"

interface User {
    id: string
    email: string
    name?: string
    given_name?: string
    picture?: string
}

interface AuthContextValue {
    user: User | null
    loading: boolean
    signInWithGoogle: () => void
    logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const API = import.meta.env.VITE_API_URL ?? "http://localhost:8000"

export function AuthProvider({children}: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        fetch(`${API}/auth/me`, {credentials: "include"})
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => setUser(data))
            .finally(() => setLoading(false))
    }, [])

    const signInWithGoogle = useCallback(() => {
        window.location.href = `${API}/auth/login`
    }, [])

    const logout = useCallback(async () => {
        await fetch(`${API}/auth/logout`, {method: "POST", credentials: "include"})
        setUser(null)
    }, [])

    return (
        <AuthContext.Provider value={{user, loading, signInWithGoogle, logout}}>
            {children}
        </AuthContext.Provider>
    )
}

export function useAuth() {
    const ctx = useContext(AuthContext)
    if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>")
    return ctx
}