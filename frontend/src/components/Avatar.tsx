import {useState, type CSSProperties} from "react"

/**
 * A member's avatar: their Google profile picture, or an initials monogram when
 * there is none (Google may omit it, and some payloads have no member at all)
 * or when the image fails to load (offline and never seen, or a Google URL
 * that expired). This is the *only* place `picture`'s absence is handled —
 * callers pass the picture field straight through and never null-check it.
 */
interface AvatarProps {
    /** Display name — used for the image alt text and the monogram initial. */
    name: string
    /** Profile image URL, or null/undefined when there isn't one. */
    picture?: string | null
    /** Rendered width/height in pixels. */
    size?: number
    /** Extra classes (e.g. `ring-2`) merged onto the root element. */
    className?: string
    /** Hover tooltip, e.g. the name where it isn't printed beside the avatar. */
    title?: string
    /** Inline styles merged onto the root element, photo or monogram (e.g. a border). */
    style?: CSSProperties
    /** Monogram text. Defaults to the name's first letter. */
    monogram?: string
    /** Inline styles for the monogram only, overriding its default colors and font size. */
    monogramStyle?: CSSProperties
}

export default function Avatar({name, picture, size = 32, className = "", title, style, monogram, monogramStyle}: AvatarProps) {
    // The URL that failed to load, so a different picture gets a fresh try.
    const [failed, setFailed] = useState<string | null>(null)
    const dimensions = {width: size, height: size}

    if (picture && picture !== failed) {
        return (
            <img
                src={picture}
                alt={name}
                referrerPolicy="no-referrer"
                // CORS, so the service worker can keep a real (not opaque) copy for offline.
                crossOrigin="anonymous"
                title={title}
                onError={() => setFailed(picture)}
                className={`rounded-full shrink-0 object-cover ${className}`}
                style={{...dimensions, ...style}}
            />
        )
    }

    const text = monogram ?? (name.trim().charAt(0).toUpperCase() || "?")
    return (
        <span
            role="img"
            aria-label={name}
            title={title}
            className={`rounded-full shrink-0 flex items-center justify-center font-semibold select-none theme-button-bg theme-text-contrast ${className}`}
            style={{...dimensions, fontSize: size * 0.42, ...style, ...monogramStyle}}
        >
            {text}
        </span>
    )
}
