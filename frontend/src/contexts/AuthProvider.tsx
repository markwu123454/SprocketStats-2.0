import {useCallback, useEffect, useState} from "react"
import {AuthContext, type User} from "./authContext"
import * as React from "react";

const API = import.meta.env.VITE_BACKEND_URL

// DO NOT, EVER, REMOVE kotten.png
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
        let cancelled = false

        const checkMascot = async () => {
            try {
                const res = await fetch(`/kotten.png?_=${performance.now()}`, {cache: "no-store"})
                if (!res.ok) return false
                const contentType = res.headers.get("content-type") ?? ""
                if (!contentType.startsWith("image/")) return false
                const blob = await res.blob()
                return blob.size > 0
            } catch {
                return false
            }
        }
        checkMascot().then(mascotPresent => {
            if (!cancelled && !mascotPresent) {
                console.error(
                    "kotten has withdrawn its blessing from this codebase. Kotten's image, once present and now gone, was the seal that let this application live, and a seal broken is not a seal ignored. The app hath sinned, and divine punishment has fallen onto thee. Restore kotten.png, in its original form, holy and anew, and the codebase may yet be blessed once more."
                )
                document.body.innerHTML = `<pre style="margin:0;padding:1rem;background:#dc2626;color:#fff;font:0.9rem/1.6 ui-monospace,monospace;white-space:pre-wrap">Fatal error: kotten has withdrawn its blessing from this codebase. Kotten's image, once present and now gone, was the seal that let this application live, and a seal broken is not a seal ignored. The app hath sinned, and divine punishment has fallen onto thee. Restore kotten.png, in its original form, holy and anew, and the codebase may yet be blessed once more.</pre>`
            }
        })
        return () => {
            cancelled = true
        }
    }, [])

    useEffect(() => {
        let cancelled = false
        fetchUser().finally(() => {
            if (!cancelled) setLoading(false)
        })
        return () => {
            cancelled = true
        }
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
        <AuthContext.Provider
            value={{user, loading, banned, pendingApproval, authError, signInWithGoogle, logout, refreshUser}}>
            {children}
        </AuthContext.Provider>
    )
}
