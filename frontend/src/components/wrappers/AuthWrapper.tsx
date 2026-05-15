import { useEffect } from "react"
import { useAuth } from "@/contexts/authContext.tsx"

export default function AuthWrapper({ children }: { children: React.ReactNode }) {
  const { user, loading, signInWithGoogle } = useAuth()

  useEffect(() => {
    if (!loading && !user) signInWithGoogle()
  }, [user, loading, signInWithGoogle])

  if (loading) return null
  if (!user) return null

  return <>{children}</>
}