import { createContext, useContext } from "react"

// Context object + hook live here (no components) so the provider file can own
// the component surface without React Fast Refresh complaining about a file that
// mixes components and non-components. The provider lives in AppReadyProvider.tsx.

export const AppReadyContext = createContext<() => void>(() => {})

export const useAppReady = () => useContext(AppReadyContext)
