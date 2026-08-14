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
    // This member's kiosk check-in code. Generated at account creation, so it's
    // present before onboarding too. Treat as a credential in the UI (masked by
    // default) even though it's scoped to this user's own session response.
    offline_code: string
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
 * The single reason (if any) the login screen has something to tell the user.
 * Mutually exclusive by construction — AuthProvider only ever has one of
 * these active at a time, replacing whatever was there before rather than
 * layering on top of it.
 *
 *  - `"banned"` — last /auth/me came back 403 "banned": a real account, blocked.
 *  - `"pendingApproval"` — last /auth/me came back 403 "pending approval": onboarded
 *    into a privileged role, awaiting a captain/mentor.
 *  - `"authError"` — last /auth/me failed for a reason other than "not signed
 *    in", banned, or pending (network failure, 404, 500, 503, ...). Signing in
 *    would just hit the same broken backend, so the login UI blocks the button
 *    rather than bouncing the user through a dead redirect.
 *  - `"signInError"` — the OAuth popup reported the exchange itself failed
 *    (Google rejected it, callback error, etc). Distinct from `"authError"`,
 *    which is about the backend being unreachable, not a bad sign-in attempt.
 *  - `"signInCancelled"` — the popup closed without ever reporting a result.
 *    In practice almost always the user closing it partway through, not a
 *    failure, so it gets its own non-alarming wording.
 */
export type LoginNotice = "banned" | "pendingApproval" | "authError" | "signInError" | "signInCancelled" | null

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
}

export const AuthContext = createContext<AuthContextValue | null>(null)

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
    const { user } = useAuth()
    if (!user || !user.onboarding_complete) {
        throw new Error("useOnboardedUser must be used under <AuthWrapper>")
    }
    return user
}
