import type {ComponentProps} from "react"
import {buttonClass, type ButtonSize, type ButtonVariant} from "@/lib/uiClasses"

export interface ButtonProps extends ComponentProps<"button"> {
    variant?: ButtonVariant
    size?: ButtonSize
}

/** The one button (design-system/buttons.md). Everything else is passed through to the <button>. */
export default function Button({variant = "filled", size = "default", className = "", type = "button", ...rest}: ButtonProps) {
    return <button type={type} className={buttonClass({variant, size, className})} {...rest}/>
}
