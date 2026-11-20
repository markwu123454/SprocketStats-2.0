import { createContext, useContext } from "react"
import type { PermPolicy } from "@/lib/permissions"

// Context object + hooks + user types live here (no components) so the provider
// file can own the component surface without React Fast Refresh complaining
// about a file that mixes components and non-components. The provider lives in
// AuthProvider.tsx.

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
    // True when this user hid their photo from other members (Settings): the
    // server sends others null in its place, so they see the initial. Optional
    // because a profile saved on the phone by an older build won't have it.
    hide_picture?: boolean
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

/**
 * The single reason (if any) the login screen has something to tell the user
 * about their account or sign-in attempt. Mutually exclusive by construction —
 * AuthProvider only ever has one of these active at a time, replacing whatever
 * was there before rather than layering on top of it. Not reaching the server
 * at all is `connection`, not a notice.
 *
 *  - `"banned"` — last /auth/me came back 403 "banned": a real account, blocked.
 *  - `"pendingApproval"` — last /auth/me came back 403 "pending approval": onboarded
 *    into a privileged role, awaiting a captain/mentor.
 *  - `"signInError"` — the OAuth popup reported the exchange itself failed
 *    (Google rejected it, callback error, etc).
 *  - `"signInCancelled"` — the popup closed without ever reporting a result.
 *    In practice almost always the user closing it partway through, not a
 *    failure, so it gets its own non-alarming wording.
 */
export type LoginNotice = "banned" | "pendingApproval" | "signInError" | "signInCancelled" | null

/**
 * Why the last connection check (GET /auth/me, 3 s limit) didn't reach the server:
 *
 *  - `"noNetwork"` — the phone has no connection, or the request failed outright.
 *  - `"slow"` — no answer within the time limit.
 *  - `"serverDown"` — the server answered with an error (404, 500, 503...).
 */
export type ConnectionProblem = "noNetwork" | "slow" | "serverDown"

export interface AuthContextValue {
    user: User | null
    loading: boolean
    loginNotice: LoginNotice
    // True while the Google OAuth popup is open, from click until it reports
    // back (success, failure, or the user closing it manually).
    signingIn: boolean
    signInWithGoogle: () => void
    logout: () => Promise<void>
    refreshUser: () => Promise<void>
    /** Set while the server can't be reached. The app re-checks every 5 s on its own. */
    connection: ConnectionProblem | null
    /** Signed in (or still signed in) while the server can't be reached: pages show saved info. */
    offline: boolean
    /** Who "Continue offline" would sign in on the login screen, if anyone can. */
    offlineUser: OnboardedUser | null
    /** This phone had a signed-in member, but too long ago (30 days) to continue offline. */
    offlineExpired: boolean
    continueOffline: () => void
    /**
     * Keep the member signed in while something can't be interrupted (My code
     * on screen): a lapsed session found meanwhile signs them out only once
     * every hold is released. Returns the release function.
     */
    holdSession: () => () => void
    /** Something holds the session (My code is up): nothing else may cover the screen. */
    sessionHeld: boolean
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
    const ctx = useContext(AuthContext)
    if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>")
    return ctx
}

/** Whether the app is running on saved info because the server can't be reached. */
export function useIsOffline(): boolean {
    return useAuth().offline
}

/**
 * Like {@link useAuth} but for components mounted under `<AuthWrapper>`, where the
 * user is guaranteed signed-in and onboarded. Returns the narrowed
 * {@link OnboardedUser} directly, so callers read `name`/`display_name`/`role`
 * without null/optional handling. Throws if the guarantee is violated — that's a
 * routing bug (the component wasn't placed under the guard), not a runtime state.
 */
export function useOnboardedUser(): OnboardedUser {
    const { user } = useAuth()
    if (!user || !user.onboarding_complete) {
        throw new Error("useOnboardedUser must be used under <AuthWrapper>")
    }
    return user
}
