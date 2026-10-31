import type {CSSProperties} from "react"

interface SkeletonProps {
    className?: string
    style?: CSSProperties
}

/** Loading placeholder (design-system/loading.md). Size it to the content it stands in for. Static under reduced motion. */
export default function Skeleton({className = "", style}: SkeletonProps) {
    return (
        <div
            aria-hidden="true"
            className={`animate-pulse motion-reduce:animate-none rounded-lg ${className}`.trim()}
            style={{background: "color-mix(in oklch, var(--theme-text) 12%, transparent)", ...style}}
        />
    )
}
