import {Component, useEffect, type ErrorInfo, type ReactNode} from "react"
import {useLocation} from "react-router-dom"
import {RotateCw, TriangleAlert} from "lucide-react"
import {useAppReady} from "@/contexts/appReadyContext"
import Button from "@/components/ui/Button"
import EmptyState from "@/components/ui/EmptyState"
import Skeleton from "@/components/ui/Skeleton"
import {
    canRecoverFromChunkError, clearChunkRecovery, isChunkLoadError, recoverFromChunkError,
} from "@/lib/chunkRecovery"

interface BoundaryProps {
    children: ReactNode
    /** Changing it clears the error (the path, so leaving the page recovers). */
    resetKey: string
}

interface BoundaryState {
    failed: boolean
    /** The page's code didn't load and the app is reloading onto the current build. */
    updating: boolean
    resetKey: string
}

class Boundary extends Component<BoundaryProps, BoundaryState> {
    state: BoundaryState = {failed: false, updating: false, resetKey: this.props.resetKey}

    static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
        return {failed: true, updating: isChunkLoadError(error) && canRecoverFromChunkError()}
    }

    static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState): Partial<BoundaryState> | null {
        return props.resetKey === state.resetKey ? null : {failed: false, updating: false, resetKey: props.resetKey}
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error("Page crashed:", error, info.componentStack)
        // Usually a page still on the previous deploy asking for a chunk that
        // no longer exists (lib/chunkRecovery.ts). Reloading fixes it.
        if (this.state.updating) {
            void recoverFromChunkError().then(reloading => {
                if (!reloading) this.setState({updating: false})
            })
        }
    }

    render() {
        if (!this.state.failed) return this.props.children
        return this.state.updating ? <PageUpdating/> : <PageFailed/>
    }
}

/**
 * A page that crashes while rendering, or whose code can't be loaded, shows
 * this instead of taking the whole app down to a blank screen. Mounted around
 * every route (App.tsx) and again around the page inside the app shell, so
 * the top bar and tabs stay usable. Going to another page clears it.
 */
export default function PageErrorBoundary({children}: {children: ReactNode}) {
    const {pathname} = useLocation()
    return <Boundary resetKey={pathname}>{children}</Boundary>
}

// Shown for the moment between a chunk failing and the reload that fixes it.
// The layout stays put (design-system/loading.md), so the reload barely shows.
function PageUpdating() {
    const markReady = useAppReady()
    useEffect(() => markReady(), [markReady])

    return (
        <div className="w-full max-w-xl mx-auto px-4 py-6" role="status" aria-label="Loading the latest version">
            <Skeleton className="h-48 w-full rounded-xl"/>
        </div>
    )
}

// "Page failed to load" (design-system/empty-error-states.md). A reload, not a
// re-render: a page whose code failed to load stays failed until the app reloads.
function PageFailed() {
    // A crash before the first page finished would leave the splash on top.
    const markReady = useAppReady()
    useEffect(() => markReady(), [markReady])

    // A manual reload gets the full chunk recovery again if it fails the same way.
    const reload = () => {
        clearChunkRecovery()
        window.location.reload()
    }

    return (
        <div className="w-full max-w-xl mx-auto px-4 py-6">
            <div className="rounded-xl border min-h-48 flex flex-col justify-center backdrop-blur-sm theme-bg theme-border">
                <EmptyState
                    variant="screen"
                    icon={<TriangleAlert size={21}/>}
                    title="This page couldn't load"
                    action={<Button onClick={reload}><RotateCw size={16}/>Reload</Button>}
                >
                    Reload the app to try again.
                </EmptyState>
            </div>
        </div>
    )
}
