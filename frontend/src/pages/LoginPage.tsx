import { useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@/contexts/authContext.tsx"

export default function LoginPage() {
    const { user, loading, signInWithGoogle } = useAuth()
    const navigate = useNavigate()

    useEffect(() => {
        if (!loading && user) {
            navigate("/dashboard", { replace: true })
        }
    }, [user, loading, navigate])

    return (
        <div className="h-screen w-screen flex flex-col items-center justify-center overflow-hidden theme-bg-page bg-cover">
            <div
                className="flex flex-col items-center gap-6 p-10 rounded-2xl border shadow-2xl backdrop-blur-sm w-full max-w-sm mx-4"
                style={{ background: "var(--theme-bg)", borderColor: "var(--theme-border)" }}
            >
                {/* Animated logo */}
                <div className="relative w-24 h-24 select-none">
                    <img
                        className="absolute inset-0 w-full h-full object-contain"
                        style={{ animation: "spin 14s linear infinite" }}
                        src="/static/sprocket_logo_ring.png"
                        alt=""
                    />
                    <img
                        className="absolute inset-0 w-full h-full object-contain"
                        style={{ animation: "spin-rev 10s linear infinite" }}
                        src="/static/sprocket_logo_gear.png"
                        alt=""
                    />
                </div>

                {/* Brand text */}
                <div className="text-center">
                    <h1 className="text-2xl font-bold theme-text">SprocketStats</h1>
                    <p className="text-sm mt-1 theme-subtext-color">FRC Scouting &amp; Analytics</p>
                </div>

                {/* Sign-in button */}
                <button
                    onClick={signInWithGoogle}
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-lg border font-medium text-sm transition-all hover:opacity-90 active:scale-95 disabled:opacity-50"
                    style={{
                        background: "var(--theme-button-bg)",
                        borderColor: "var(--theme-border)",
                        color: "var(--theme-text)",
                    }}
                >
                    {/* Google logo */}
                    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                        <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
                        <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
                        <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
                        <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
                    </svg>
                    {loading ? "Signing in…" : "Sign in with Google"}
                </button>

                <p className="text-xs theme-subtext-color text-center">
                    Access restricted to authorized team members.
                </p>
            </div>

            <style>{`
                @keyframes spin { to { transform: rotate(360deg); } }
                @keyframes spin-rev { to { transform: rotate(-360deg); } }
            `}</style>
        </div>
    )
}