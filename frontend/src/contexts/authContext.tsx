import {createContext, useCallback, useContext, useEffect, useState} from "react"
import type {PermPolicy} from "@/lib/permissions"

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
        const data = (await fetch(`${API}/auth/me`, {credentials: "include"})
            .then((r) => (r.ok ? r.json() : null))) as User | null
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