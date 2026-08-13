import { type ReactNode, useEffect, useState } from "react"
import {type BootstrapCache, BootstrapContext } from "./bootstrapContext"

const API = import.meta.env.VITE_BACKEND_URL

export function BootstrapProvider({ children }: { children: ReactNode }) {
    const [cache, setCache] = useState<BootstrapCache>({})

    useEffect(() => {
        fetch(`${API}/bootstrap`, { credentials: "include" })
            .then(r => r.ok ? r.json() : {})
            .then(setCache)
            .catch(() => {})
    }, [])

    return (
        <BootstrapContext.Provider value={cache}>
            {children}
        </BootstrapContext.Provider>
    )
}
