import { useEffect, useState } from "react"
import { FlaskConical } from "lucide-react"
import Sheet from "@/components/ui/Sheet"
import Notice from "@/components/ui/Notice"
import Skeleton from "@/components/ui/Skeleton"
import { focusRing, menuRowClass } from "@/lib/uiClasses"

const API = import.meta.env.VITE_BACKEND_URL

interface DevUser {
    id: string
    name: string
    role: string | null
    role_label: string | null
    status: "active" | "pending" | "banned" | "not_onboarded"
}

const STATUS_LABEL: Record<DevUser["status"], string | null> = {
    active: null,
    pending: "Pending approval",
    banned: "Banned",
    not_onboarded: "Not onboarded",
}

/**
 * Sign in as any user in the dev database, without Google. Only in dev builds
 * (the login page renders it behind `import.meta.env.DEV`), and the backend routes
 * behind it exist only with `ENV=development` (backend/endpoints/dev_auth.py).
 * This is how a phone signs in to `npm run dev:phone` (CONTRIBUTING.md).
 */
export default function DevSignIn() {
    const [open, setOpen] = useState(false)

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className={`fixed right-3 z-[100] flex items-center gap-1.5 min-h-11 px-3.5 rounded-full border text-sm font-semibold theme-bg theme-border theme-text-contrast shadow-lg ${focusRing}`}
                style={{ top: "max(12px, env(safe-area-inset-top))" }}
            >
                <FlaskConical size={16} aria-hidden="true" />
                Dev sign-in
            </button>
            {open && <DevUserSheet onClose={() => setOpen(false)} />}
        </>
    )
}

function DevUserSheet({ onClose }: { onClose: () => void }) {
    const [users, setUsers] = useState<DevUser[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [signingIn, setSigningIn] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        fetch(`${API}/auth/dev/users`, { credentials: "include" })
            .then(async res => {
                if (res.status === 404) throw new Error("Dev sign-in is off. Set ENV=development in backend/.env and restart the backend.")
                if (!res.ok) throw new Error(`The backend answered ${res.status}.`)
                return res.json() as Promise<DevUser[]>
            })
            .then(list => { if (!cancelled) setUsers(list) })
            .catch(err => {
                if (!cancelled) setError(err instanceof TypeError ? "Can't reach the backend. Is it running?" : String(err.message ?? err))
            })
        return () => { cancelled = true }
    }, [])

    async function signIn(user: DevUser) {
        setSigningIn(user.id)
        setError(null)
        try {
            const res = await fetch(`${API}/auth/dev/login`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ user_id: user.id }),
            })
            if (!res.ok) throw new Error()
            // A full load, so the app starts signed in as this user from scratch.
            window.location.assign("/")
        } catch {
            setError("Couldn't sign in as that user.")
            setSigningIn(null)
        }
    }

    return (
        <Sheet title="Sign in as…" kind="form" onClose={onClose}>
            <div className="flex flex-col gap-2">
                <p className="text-xs theme-subtext-color">Development only. Picks a user from the dev database; no Google.</p>
                {error && <Notice>{error}</Notice>}
                {!users && !error && (
                    <div className="flex flex-col gap-2">
                        <Skeleton className="h-12" />
                        <Skeleton className="h-12" />
                        <Skeleton className="h-12" />
                    </div>
                )}
                {users && users.length === 0 && <p className="text-sm theme-subtext-color">The dev database has no users. Sign in with Google once on this computer first.</p>}
                {users && (
                    <ul className="flex flex-col">
                        {users.map(u => {
                            const status = STATUS_LABEL[u.status]
                            return (
                                <li key={u.id}>
                                    <button
                                        type="button"
                                        disabled={signingIn !== null}
                                        onClick={() => void signIn(u)}
                                        className={`${menuRowClass} theme-text disabled:opacity-50`}
                                    >
                                        <span className="flex flex-col min-w-0">
                                            <span className="font-semibold truncate">{u.name}</span>
                                            <span className="text-xs theme-subtext-color truncate">
                                                {u.role_label ?? "No role yet"}{status ? ` · ${status}` : ""}
                                            </span>
                                        </span>
                                        {signingIn === u.id && <span className="text-xs theme-subtext-color shrink-0">Signing in…</span>}
                                    </button>
                                </li>
                            )
                        })}
                    </ul>
                )}
            </div>
        </Sheet>
    )
}
