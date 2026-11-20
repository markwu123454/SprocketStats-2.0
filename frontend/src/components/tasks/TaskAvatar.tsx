import type {CSSProperties} from "react"
import Avatar from "@/components/Avatar"
import {AVATAR_INK, avatarBg, initialOf} from "@/lib/taskFormat"

/** A person on the task board: their profile picture, or the board's pastel initial swatch. */
export default function TaskAvatar({name, picture, title, style}: {
    name: string | null | undefined
    picture?: string | null
    title?: string
    style?: CSSProperties
}) {
    return (
        <Avatar
            name={name ?? "Someone"}
            picture={picture}
            size={24}
            title={title}
            style={style}
            monogram={initialOf(name)}
            monogramStyle={{background: avatarBg(name ?? "?"), color: AVATAR_INK, fontSize: 12, fontWeight: 700}}
        />
    )
}
