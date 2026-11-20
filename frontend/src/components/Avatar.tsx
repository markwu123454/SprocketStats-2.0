import {useState} from "react"

/**
 * User avatar with a single fallback for the one deliberately-optional user
 * field, `picture`. Renders the profile image when present and loadable,
 * otherwise an initials monogram. This is the *only* place `picture`'s absence
 * is handled — callers pass `user.picture` straight through and never
 * null-check it.
 */
interface AvatarProps {
    /** Display name — used for the image alt text and the monogram initial. */
    name: string
    /** Profile image URL, or undefined (Google may omit it). */
    picture?: string
    /** Rendered width/height in pixels. */
    size?: number
    /** Extra classes (e.g. `ring-2`) merged onto the root element. */
    className?: string
}

export default function Avatar({name, picture, size = 32, className = ""}: AvatarProps) {
    const dimensions = {width: size, height: size}
    // The photo that didn't load (offline and never seen, or a Google URL that
    // expired): show the monogram rather than a broken image.
    const [failed, setFailed] = useState<string | null>(null)

    if (picture && picture !== failed) {
        return (
            <img
                src={picture}
                alt={name}
                referrerPolicy="no-referrer"
                // CORS, so the service worker can keep a real (not opaque) copy for offline.
                crossOrigin="anonymous"
                onError={() => setFailed(picture)}
                className={`rounded-full shrink-0 object-cover ${className}`}
                style={dimensions}
            />
        )
    }

    const initial = name.trim().charAt(0).toUpperCase() || "?"
    return (
        <div
            role="img"
            aria-label={name}
            className={`rounded-full shrink-0 flex items-center justify-center font-semibold select-none theme-button-bg theme-text-contrast ${className}`}
            style={{...dimensions, fontSize: size * 0.42}}
        >
            {initial}
        </div>
    )
}
