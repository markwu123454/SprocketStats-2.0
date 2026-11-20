import {Component, useEffect, type ErrorInfo, type ReactNode} from "react"
import {useLocation} from "react-router-dom"
import {RotateCw, TriangleAlert} from "lucide-react"
import {useAppReady} from "@/contexts/appReadyContext"
import Button from "@/components/ui/Button"
import EmptyState from "@/components/ui/EmptyState"

interface BoundaryProps {
    children: ReactNode
    /** Changing it clears the error (the path, so leaving the page recovers). */
    resetKey: string
}

interface BoundaryState {
    failed: boolean
    resetKey: string
}

class Boundary extends Component<BoundaryProps, BoundaryState> {
    state: BoundaryState = {failed: false, resetKey: this.props.resetKey}

    static getDerivedStateFromError(): Partial<BoundaryState> {
        return {failed: true}
    }

    static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState): Partial<BoundaryState> | null {
        return props.resetKey === state.resetKey ? null : {failed: false, resetKey: props.resetKey}
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error("Page crashed:", error, info.componentStack)
    }

    render() {
        return this.state.failed ? <PageFailed/> : this.props.children
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

// "Page failed to load" (design-system/empty-error-states.md). A reload, not a
// re-render: a page whose code failed to load stays failed until the app reloads.
function PageFailed() {
    // A crash before the first page finished would leave the splash on top.
    const markReady = useAppReady()
    useEffect(() => markReady(), [markReady])

    return (
        <div className="w-full max-w-xl mx-auto px-4 py-6">
            <div className="rounded-xl border min-h-48 flex flex-col justify-center backdrop-blur-sm theme-bg theme-border">
                <EmptyState
                    variant="screen"
                    icon={<TriangleAlert size={21}/>}
                    title="This page couldn't load"
                    action={<Button onClick={() => window.location.reload()}><RotateCw size={16}/>Reload</Button>}
                >
                    Reload the app to try again.
                </EmptyState>
            </div>
        </div>
    )
}
