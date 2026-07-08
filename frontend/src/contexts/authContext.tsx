import {createContext, useCallback, useContext, useEffect, useState} from "react"
import type {PermPolicy} from "@/lib/permissions"

/** A notice targeted at the current user that they haven't responded to yet. */
export interface PendingNotification {
    id: string
    title: string
    body: string
    link: string | null
    hard_block: boolean
    response_options: string[]
    response_mode: "single" | "multi"
}

/** Fields present on every authenticated user, regardless of onboarding state. */
interface BaseUser {
    id: string
    email: string
    // Deliberately optional: Google may omit it and we don't generate one.
    // This is the one user field with no downstream non-null guarantee.
    picture?: string
    // Resolved role policy from the backend (access permissions + role
    // attributes like `label`/`school_info`). Always sent by `/auth/me`
    // (an empty object for a role-less user). Read via `can`/`getPerm`.
    permissions: PermPolicy
    // Notices targeted at this user's role that they haven't acted on yet,
    // hard-blocking notices first. Always sent by `/auth/me` (empty array if none).
    pending_notifications: PendingNotification[]
}

/** A signed-in user who hasn't finished onboarding yet — profile fields may be absent. */
export interface PendingUser extends BaseUser {
    onboarding_complete: false
    name?: string
    given_name?: string
    display_name?: string
    role?: string
    grade?: string
    team_year?: string
}

/**
 * A fully onboarded user. The DB `onboarded_fields_present` CHECK guarantees
 * these are non-null once `onboarding_complete` is true, so downstream code can
 * read them without fallbacks. `grade`/`team_year` stay optional (mentor/alumni
 * roles have no school info); `picture` stays optional by design.
 */
export interface OnboardedUser extends BaseUser {
    onboarding_complete: true
    name: string
    given_name: string
    display_name: string
    role: string
    grade?: string
    team_year?: string
}

export type User = PendingUser | OnboardedUser

interface AuthContextValue {
    user: User | null
    loading: boolean
    // Set when the last /auth/me call came back 403 "banned" — the account is
    // real but has been banned, distinct from simply not being signed in.
    banned: boolean
    signInWithGoogle: () => void
    logout: () => Promise<void>
    refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const API = import.meta.env.VITE_BACKEND_URL

export function AuthProvider({children}: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null)
    const [loading, setLoading] = useState(true)
    const [banned, setBanned] = useState(false)

    const fetchUser = useCallback(async () => {
        const res = await fetch(`${API}/auth/me`, {credentials: "include"})
        if (res.status === 403) {
            // Banned accounts hold a technically-valid cookie, so clear it
            // server-side too — otherwise every subsequent /auth/me repeats the 403
            // and no other endpoint will ever notice they're banned.
            await fetch(`${API}/auth/logout`, {method: "POST", credentials: "include"})
            setBanned(true)
            setUser(null)
            return
        }
        setBanned(false)
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
    }, [])

    const refreshUser = useCallback(async () => {
        await fetchUser()
    }, [fetchUser])

    return (
        <AuthContext.Provider value={{user, loading, banned, signInWithGoogle, logout, refreshUser}}>
            {children}
        </AuthContext.Provider>
    )
}

export function useAuth() {
    const ctx = useContext(AuthContext)
    if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>")
    return ctx
}

/**
 * Like {@link useAuth} but for components mounted under `<AuthWrapper>`, where the
 * user is guaranteed signed-in and onboarded. Returns the narrowed
 * {@link OnboardedUser} directly, so callers read `name`/`display_name`/`role`
 * without null/optional handling. Throws if the guarantee is violated — that's a
 * routing bug (the component wasn't placed under the guard), not a runtime state.
 */
export function useOnboardedUser(): OnboardedUser {
    const {user} = useAuth()
    if (!user || !user.onboarding_complete) {
        throw new Error("useOnboardedUser must be used under <AuthWrapper>")
    }
    return user
}