/**
 * User avatar with a single fallback for the one deliberately-optional user
 * field, `picture`. Renders the profile image when present, otherwise an
 * initials monogram. This is the *only* place `picture`'s absence is handled —
 * callers pass `user.picture` straight through and never null-check it.
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

    if (picture) {
        return (
            <img
                src={picture}
                alt={name}
                referrerPolicy="no-referrer"
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
