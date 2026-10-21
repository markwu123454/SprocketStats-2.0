interface CheckboxProps {
    checked: boolean
    onChange: () => void
    indeterminate?: boolean
    "aria-label"?: string
    className?: string
}

export default function Checkbox({ checked, onChange, indeterminate = false, className = "", ...rest }: CheckboxProps) {
    const filled = checked || indeterminate
    return (
        <span className={`relative inline-flex shrink-0 ${className}`}>
            <input
                type="checkbox"
                checked={checked}
                onChange={onChange}
                aria-label={rest["aria-label"]}
                aria-checked={indeterminate ? "mixed" : checked}
                className="peer absolute inset-0 w-full h-full opacity-0 cursor-pointer m-0"
            />
            <span
                className="w-4 h-4 rounded border flex items-center justify-center transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--theme-text-contrast)]"
                style={{
                    background:  filled ? "var(--theme-text-contrast)" : "var(--theme-bg)",
                    borderColor: filled ? "var(--theme-text-contrast)" : "var(--theme-border)",
                }}
            >
                {indeterminate ? (
                    <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                        <path d="M2 4h6" stroke="var(--theme-bg)" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                ) : checked ? (
                    <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                        <path d="M1 4l2.5 2.5L9 1" stroke="var(--theme-bg)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                ) : null}
            </span>
        </span>
    )
}
