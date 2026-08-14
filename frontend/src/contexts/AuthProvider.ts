import {createElement, useCallback, useEffect, useState} from "react"
import {AuthContext} from "./authContext"
import type {LoginNotice} from "./authContext"
import * as React from "react";

const API = import.meta.env.VITE_BACKEND_URL

// Imagine this script is obfuscated and you have no idea what it does
// SO NEVER EVER REMOVE KOTTEN,THIS CHECK IS JUST THE PREVENTION LAYER, YOU WILL ACTUALLY BE CURSED IF KOTTEN IS REMOVED!
export function AuthProvider({children}: {children: React.ReactNode}) {
    const [user, setUser] = useState(null)
    const [loading, setLoading] = useState(true)
    const [loginNotice, setLoginNotice] = useState<LoginNotice>(null)
    const [signingIn, setSigningIn] = useState(false)

    const fetchUser = useCallback(async () => {
        let res
        try {
            res = await fetch(`${API}/auth/me`, {credentials: "include"})
        } catch {
            // Network failure / server unreachable — distinct from "not signed in".
            setLoginNotice("authError")
            setUser(null)
            return
        }

        if (res.status === 403) {
            // 403 means the account is real but blocked — either banned or awaiting
            // approval. Both hold a technically-valid cookie, so clear it server-side
            // too, else every subsequent /auth/me just repeats the 403. The `detail`
            // string tells the two cases apart so login shows the right notice.
            const detail = await res.json().then(d => d?.detail).catch(() => undefined)
            await fetch(`${API}/auth/logout`, {method: "POST", credentials: "include"})
            const isPending = typeof detail === "string" && detail.toLowerCase().includes("pending")
            setLoginNotice(isPending ? "pendingApproval" : "banned")
            setUser(null)
            return
        }

        if (!res.ok && res.status !== 401) {
            // Anything other than "not signed in" (401) is a broken backend
            // (404/500/503/...) — don't let the user proceed to /auth/login,
            // which would just redirect back to the same dead server.
            setLoginNotice("authError")
            setUser(null)
            return
        }

        // A fresh, successful read always supersedes whatever the last
        // sign-in attempt reported, so the login screen never shows a stale
        // notice next to a current one.
        setLoginNotice(null)
        setUser(res.ok ? (await res.json()) : null)
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

        if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
            try {
                // #0e0e0e matches the actual dark-mode background of Google's
                // account chooser (accounts.google.com), sampled directly from
                // a screenshot rather than guessed.
                popup.document.write('<!doctype html><html><body style="background:#0e0e0e;margin:0"></body></html>')
                popup.document.close()
            } catch {
                // Best-effort cosmetic touch — a failure here shouldn't block sign-in.
            }
        }

        popup.location.href = `${API}/auth/login`

        // Starting a new attempt supersedes whatever notice was left over
        // from before (a stale ban/pending/authError notice, or a previous
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
        }, 500)
    }, [fetchUser])

    const logout = useCallback(async () => {
        await fetch(`${API}/auth/logout`, {method: "POST", credentials: "include"})
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
        {value: {user, loading, loginNotice, signingIn, signInWithGoogle, logout, refreshUser}},
        children
    )
}
