import {createElement, useCallback, useEffect, useMemo, useRef, useState} from "react"
import {AuthContext} from "./authContext"
import type {ConnectionProblem, LoginNotice, OnboardedUser, User} from "./authContext"
import * as React from "react";
import {clearMemberCodeKey, syncMemberCodeKey} from "@/lib/memberCode"
import {
    CHECK_TIMEOUT_MS, RETRY_MS, checkSession, clearOfflineData, lastOnlineAt, markOnline,
    setPendingLogout, withinOfflineWindow,
} from "@/lib/offline"

const API = import.meta.env.VITE_BACKEND_URL

// The last /auth/me profile, so a member who was signed in on this phone can
// continue offline (see lib/offline.ts). The offline_code credential is left
// out of the copy.
const CACHED_USER_KEY = "sprocket-cached-user"

function readCachedUser() {
    try {
        const raw = localStorage.getItem(CACHED_USER_KEY)
        return raw ? JSON.parse(raw) : null
    } catch {
        return null
    }
}

function writeCachedUser(user: Record<string, unknown> | null) {
    try {
        if (user) {
            const {offline_code: _omit, ...rest} = user
            void _omit
            localStorage.setItem(CACHED_USER_KEY, JSON.stringify(rest))
        } else {
            localStorage.removeItem(CACHED_USER_KEY)
        }
    } catch {
        // Storage blocked: offline sign-in just won't be available.
    }
}

function forgetDevice() {
    writeCachedUser(null)
    clearOfflineData()
    void clearMemberCodeKey()
}

/** The saved profile, if it can sign in offline right now, and whether one exists but is too old. */
function offlineCandidate(): {user: OnboardedUser | null, expired: boolean} {
    const cached = readCachedUser() as User | null
    if (!cached || !cached.onboarding_complete) return {user: null, expired: false}
    return withinOfflineWindow(lastOnlineAt()) ? {user: cached, expired: false} : {user: null, expired: true}
}

// Imagine this script is obfuscated and you have no idea what it does
// SO NEVER EVER REMOVE KOTTEN,THIS CHECK IS JUST THE PREVENTION LAYER, YOU WILL ACTUALLY BE CURSED IF KOTTEN IS REMOVED!
export function AuthProvider({children}: {children: React.ReactNode}) {
    const [user, setUser] = useState<User | null>(null)
    const [loading, setLoading] = useState(true)
    const [loginNotice, setLoginNotice] = useState<LoginNotice>(null)
    const [signingIn, setSigningIn] = useState(false)
    const [connection, setConnection] = useState<ConnectionProblem | null>(null)
    const prefetchedLoginUrl = useRef<string | null>(null)
    // The check in flight: a second caller (retry tick, focus, StrictMode's
    // double mount) shares it instead of starting another.
    const inflight = useRef<Promise<void> | null>(null)
    // My code is on screen: a lapsed session waits until it closes (holdSession).
    const holds = useRef(0)
    const [sessionHeld, setSessionHeld] = useState(false)
    const deferredSignOut = useRef(false)

    // The connection check (lib/offline.ts): one GET /auth/me with a 3 s limit
    // answers both "can we reach the server" and "who is signed in". When the
    // server can't be reached, nothing about the user changes: whoever is
    // signed in stays signed in (now offline), and the login screen offers
    // "Continue offline" to whoever can.
    const fetchUser = useCallback((): Promise<void> => {
        const run = async () => {
            const result = await checkSession(API)
            if (result.kind === "unreachable") {
                setConnection(result.problem)
                return
            }
            // The session lapsed while My code is up: change nothing until it
            // closes, so the code stays on screen through the scan.
            if (result.kind === "signedOut" && holds.current > 0) {
                deferredSignOut.current = true
                return
            }
            setConnection(null)

            if (result.kind === "blocked") {
                forgetDevice()
                // 403 means the account is real but blocked — either banned or awaiting
                // approval. Both hold a technically-valid cookie, so clear it server-side
                // too, else every subsequent /auth/me just repeats the 403. The `detail`
                // string tells the two cases apart so login shows the right notice.
                await fetch(`${API}/auth/logout`, {method: "POST", credentials: "include"}).catch(() => {})
                const isPending = result.detail?.toLowerCase().includes("pending") ?? false
                setLoginNotice(isPending ? "pendingApproval" : "banned")
                setUser(null)
                return
            }

            // A fresh, successful read always supersedes whatever the last
            // sign-in attempt reported, so the login screen never shows a stale
            // notice next to a current one.
            setLoginNotice(null)
            if (result.kind === "user") {
                const me = result.me as unknown as User
                writeCachedUser(result.me)
                markOnline()
                // Download (or refresh) the member-code key while we're online.
                if (me.onboarding_complete) syncMemberCodeKey().catch(() => {})
                setUser(me)
            } else {
                forgetDevice()
                setUser(null)
            }
        }
        inflight.current ??= run().finally(() => { inflight.current = null })
        return inflight.current
    }, [])

    // While the server can't be reached, keep checking in the background. There
    // is no "try again" button anywhere: the app just notices.
    useEffect(() => {
        if (connection === null) return
        const id = window.setInterval(() => void fetchUser(), RETRY_MS)
        return () => window.clearInterval(id)
    }, [connection, fetchUser])

    // The phone saying it lost its network is believed at once; regaining it,
    // or the app coming back to the foreground, triggers a check.
    useEffect(() => {
        const onOffline = () => setConnection(prev => prev ?? "noNetwork")
        const onOnline = () => void fetchUser()
        const onVisible = () => { if (document.visibilityState === "visible") void fetchUser() }
        window.addEventListener("offline", onOffline)
        window.addEventListener("online", onOnline)
        document.addEventListener("visibilitychange", onVisible)
        return () => {
            window.removeEventListener("offline", onOffline)
            window.removeEventListener("online", onOnline)
            document.removeEventListener("visibilitychange", onVisible)
        }
    }, [fetchUser])

    const holdSession = useCallback(() => {
        holds.current += 1
        setSessionHeld(true)
        let released = false
        return () => {
            if (released) return
            released = true
            holds.current -= 1
            if (holds.current > 0) return
            setSessionHeld(false)
            if (deferredSignOut.current) {
                deferredSignOut.current = false
                void fetchUser()
            }
        }
    }, [fetchUser])

    // Re-read on every connection change: signing out (or a check that found
    // the session gone) clears the saved profile.
    const candidate = useMemo(
        () => (user === null && connection !== null ? offlineCandidate() : {user: null, expired: false}),
        [user, connection],
    )

    const continueOffline = useCallback(() => {
        const {user: cached} = offlineCandidate()
        if (cached) setUser(cached)
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
                // No network (e.g. opening My code with no signal): can't tell, so
                // don't treat it as missing. Only a reachable server that doesn't
                // serve kotten counts.
                return null
            }
        }
        checkMascot().then(mascotPresent => {
            if (!cancelled && mascotPresent === false) {
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

    // Pre-fetch the Google OAuth URL whenever there's no signed-in user so the
    // popup can open directly to accounts.google.com on click, skipping the
    // backend round-trip (~400ms). The URL is consumed and cleared on use; if
    // it hasn't resolved yet the popup falls back to /auth/login as before.
    useEffect(() => {
        if (loading || user || connection) return
        let cancelled = false
        fetch(`${API}/auth/login-url`, {credentials: "include"})
            .then(r => r.ok ? r.json() : null)
            .then(data => { if (!cancelled && data?.url) prefetchedLoginUrl.current = data.url })
            .catch(() => {})
        return () => { cancelled = true }
    }, [loading, user, connection])

    // Opens Google sign-in in a popup instead of navigating the main tab away.
    // The popup lands on the backend's /auth/callback, which posts a result
    // back via postMessage and closes itself (see _popup_close_html in
    // backend/endpoints/auth.py) — this window just listens and refetches the
    // user once that arrives. Keeping the main tab in place avoids a full
    // navigation round trip through the OS webview, which is what triggers
    // the iOS PWA layout bug after a redirect-based sign-in.
    const signInWithGoogle = useCallback(() => {
        const width = 480
        const height = 640
        const left = window.screenX + (window.outerWidth - width) / 2
        const top = window.screenY + (window.outerHeight - height) / 2
        // Opened blank rather than straight at the OAuth URL so we can paint
        // over the browser's default white background before handing the
        // window off to Google. In dark mode, accounts.google.com paints its
        // own dark background before the account-picker UI mounts, so a
        // plain white popup frame flashes white -> black -> content; this
        // softens it to dark -> black -> content. The blank document is
        // same-origin (inherited from us) until the navigation below, and is
        // fully discarded the instant that navigation starts — Google's page
        // never sees it, and this has no effect on the OAuth request itself.
        const popup = window.open(
            "",
            "sprocket-oauth",
            `width=${width},height=${height},left=${left},top=${top}`
        )

        // Popup blocked (e.g. Safari private mode) — fall back to a normal
        // same-tab redirect rather than leaving the button dead.
        if (!popup) {
            window.location.href = `${API}/auth/login`
            return
        }

        try {
            // Paint the popup before navigating — avoids raw about:blank while
            // the target page loads. Dark bg sampled from Google's own account
            // chooser so the transition is seamless in dark mode.
            const dark = window.matchMedia("(prefers-color-scheme: dark)").matches
            const bg = dark ? "#0e0e0e" : "#f3f4f6"
            const fg = dark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.35)"
            popup.document.write(
                `<!doctype html><html lang="en"><body style="background:${bg};margin:0;height:100vh;` +
                `display:flex;align-items:center;justify-content:center;` +
                `font:13px/1 system-ui,sans-serif;color:${fg}">Connecting to Google…</body></html>`
            )
            popup.document.close()
        } catch {
            // Best-effort cosmetic touch — a failure here shouldn't block sign-in.
        }

        // Use the pre-fetched Google URL if available (skips the backend hop),
        // otherwise fall back to /auth/login which will redirect there.
        const loginTarget = prefetchedLoginUrl.current ?? `${API}/auth/login`
        prefetchedLoginUrl.current = null
        popup.location.href = loginTarget

        // Starting a new attempt supersedes whatever notice was left over
        // from before (a stale ban/pending notice, or a previous
        // attempt's outcome) — only one should ever be showing at a time.
        setSigningIn(true)
        setLoginNotice(null)

        const backendOrigin = new URL(API).origin
        let settled = false

        // "success"/"failed" come from the callback explicitly reporting a
        // result (see _popup_close_html in backend/endpoints/auth.py).
        // "cancelled" is inferred from the popup closing with no message
        // ever arriving — in practice almost always the user backing out
        // partway through, not a real failure, so it gets its own notice
        // rather than an alarming "didn't go through, try again".
        const finish = (outcome: "success" | "failed" | "cancelled") => {
            if (settled) return
            settled = true
            window.clearInterval(poll)
            window.removeEventListener("message", onMessage)
            setSigningIn(false)
            if (outcome === "success") void fetchUser()
            else setLoginNotice(outcome === "failed" ? "signInError" : "signInCancelled")
        }

        const onMessage = (event: MessageEvent) => {
            if (event.origin !== backendOrigin) return
            if (event.data?.source !== "sprocket-auth") return
            finish(event.data.ok ? "success" : "failed")
        }
        window.addEventListener("message", onMessage)

        const poll = window.setInterval(() => {
            if (popup.closed) finish("cancelled")
        }, 200)
    }, [fetchUser])

    // Works with no connection too: the phone forgets everything now, and the
    // server-side sign-out (the session cookie is httpOnly) goes out with the
    // next check that gets through.
    const logout = useCallback(async () => {
        const controller = new AbortController()
        const timer = window.setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)
        const done = await fetch(`${API}/auth/logout`, {method: "POST", credentials: "include", signal: controller.signal})
            .then(res => res.status < 500, () => false)
            .finally(() => window.clearTimeout(timer))
        if (!done) setPendingLogout()
        forgetDevice()
        setUser(null)
        setLoginNotice(null)
    }, [])

    const refreshUser = useCallback(async () => {
        await fetchUser()
    }, [fetchUser])

    // No JSX here — this file is plain JS (see AuthProvider.d.ts for types), and
    // JSX syntax needs a build-time transform that Vite only wires up for
    // .jsx/.tsx files. createElement is the plain-JS equivalent.
    return createElement(
        AuthContext.Provider,
        {
            value: {
                user, loading, loginNotice, signingIn, signInWithGoogle, logout, refreshUser,
                connection,
                offline: user !== null && connection !== null,
                offlineUser: candidate.user,
                offlineExpired: candidate.expired,
                continueOffline,
                holdSession,
                sessionHeld,
            },
        },
        children
    )
}
