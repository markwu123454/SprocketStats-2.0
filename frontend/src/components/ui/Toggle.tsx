import {focusRing} from "@/lib/uiClasses"

interface ToggleProps {
    checked: boolean
    onChange: (next: boolean) => void
    disabled?: boolean
    "aria-label"?: string
    "aria-labelledby"?: string
    className?: string
}

/** Boolean switch (DESIGN_SYSTEM 3.4). Track is 44x24; the pseudo-element stretches the tap target to 44px tall. */
export default function Toggle({checked, onChange, disabled = false, className = "", ...aria}: ToggleProps) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={aria["aria-label"]}
            aria-labelledby={aria["aria-labelledby"]}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className={`relative inline-flex shrink-0 w-11 h-6 rounded-full border theme-outline transition-colors duration-200 before:absolute before:-inset-y-2.5 before:inset-x-0 before:content-[''] disabled:opacity-40 disabled:cursor-not-allowed ${focusRing} ${className}`.trim()}
            style={{background: checked ? "var(--theme-text-contrast)" : "color-mix(in oklch, var(--theme-text) 30%, transparent)"}}
        >
            <span
                aria-hidden="true"
                className={`absolute left-px top-px w-5 h-5 rounded-full bg-white transition-transform duration-200 ${checked ? "translate-x-5" : "translate-x-0"}`}
            />
        </button>
    )
}
