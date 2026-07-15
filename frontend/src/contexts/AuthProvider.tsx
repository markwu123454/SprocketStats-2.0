import { useCallback, useEffect, useState } from "react"
import { AuthContext, type User } from "./authContext"

const API = import.meta.env.VITE_BACKEND_URL

export function AuthProvider({children}: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null)
    const [loading, setLoading] = useState(true)
    const [banned, setBanned] = useState(false)
    const [pendingApproval, setPendingApproval] = useState(false)
    const [authError, setAuthError] = useState(false)

    const fetchUser = useCallback(async () => {
        let res: Response
        try {
            res = await fetch(`${API}/auth/me`, {credentials: "include"})
        } catch {
            // Network failure / server unreachable — distinct from "not signed in".
            setAuthError(true)
            setBanned(false)
            setPendingApproval(false)
            setUser(null)
            return
        }

        if (res.status === 403) {
            // 403 means the account is real but blocked — either banned or awaiting
            // approval. Both hold a technically-valid cookie, so clear it server-side
            // too, else every subsequent /auth/me just repeats the 403. The `detail`
            // string tells the two cases apart so login shows the right notice.
            const detail = await res.json().then(d => d?.detail as string | undefined).catch(() => undefined)
            await fetch(`${API}/auth/logout`, {method: "POST", credentials: "include"})
            const isPending = typeof detail === "string" && detail.toLowerCase().includes("pending")
            setAuthError(false)
            setBanned(!isPending)
            setPendingApproval(isPending)
            setUser(null)
            return
        }

        if (!res.ok && res.status !== 401) {
            // Anything other than "not signed in" (401) is a broken backend
            // (404/500/503/...) — don't let the user proceed to /auth/login,
            // which would just redirect back to the same dead server.
            setAuthError(true)
            setBanned(false)
            setPendingApproval(false)
            setUser(null)
            return
        }

        setAuthError(false)
        setBanned(false)
        setPendingApproval(false)
        setUser(res.ok ? (await res.json()) as User : null)
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
        setBanned(false)
        setPendingApproval(false)
    }, [])

    const refreshUser = useCallback(async () => {
        await fetchUser()
    }, [fetchUser])

    return (
        <AuthContext.Provider value={{user, loading, banned, pendingApproval, authError, signInWithGoogle, logout, refreshUser}}>
            {children}
        </AuthContext.Provider>
    )
}
