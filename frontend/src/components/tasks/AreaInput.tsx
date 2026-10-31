import { useMemo, useState, type CSSProperties, type KeyboardEvent } from "react"
import { fuzzyFilter } from "@/lib/fuzzyMatch"

interface AreaInputProps {
    value: string
    onChange: (value: string) => void
    /** Existing area names to suggest -- see `areaSuggestions`. */
    suggestions: string[]
    placeholder?: string
    className?: string
    style?: CSSProperties
}

/**
 * Free-text area field with fuzzy suggestions of areas that already exist.
 * Deliberately not a dropdown (no chevron, no forced pick): typing a new
 * name is just as valid as picking an existing one. The suggestion list only
 * appears while the field is focused and something matches.
 */
export default function AreaInput({ value, onChange, suggestions, placeholder, className, style }: AreaInputProps) {
    const [focused, setFocused] = useState(false)
    const [highlight, setHighlight] = useState(-1)

    const matches = useMemo(() => {
        const options = suggestions.map(s => ({ label: s }))
        // Hide an exact (case-insensitive) match -- it's already what's typed.
        return fuzzyFilter(options, value)
            .filter(o => o.label.toLowerCase() !== value.trim().toLowerCase())
            .slice(0, 8)
            .map(o => o.label)
    }, [suggestions, value])
    const open = focused && matches.length > 0

    function pick(area: string) {
        onChange(area)
        setHighlight(-1)
    }

    function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
        if (!open) return
        if (e.key === "ArrowDown") {
            e.preventDefault()
            setHighlight(h => (h + 1) % matches.length)
        } else if (e.key === "ArrowUp") {
            e.preventDefault()
            setHighlight(h => (h <= 0 ? matches.length - 1 : h - 1))
        } else if (e.key === "Enter" && highlight >= 0) {
            // Only swallow Enter when a suggestion is highlighted -- otherwise
            // it still submits the surrounding form.
            e.preventDefault()
            pick(matches[highlight])
        } else if (e.key === "Escape") {
            e.stopPropagation()
            setFocused(false)
        }
    }

    return (
        <div style={{ position: "relative", minWidth: 0 }}>
            <input
                value={value}
                onChange={e => { onChange(e.target.value); setHighlight(-1); setFocused(true) }}
                onFocus={() => setFocused(true)}
                onBlur={() => { setFocused(false); setHighlight(-1) }}
                onKeyDown={onKeyDown}
                placeholder={placeholder}
                autoComplete="off"
                role="combobox"
                aria-expanded={open}
                aria-autocomplete="list"
                className={className}
                style={{ width: "100%", ...style }}
            />
            {open && (
                <div
                    role="listbox"
                    className="absolute inset-x-0 top-full mt-1 z-40 flex flex-col max-h-60 overflow-y-auto rounded-xl border theme-border theme-bg p-1 shadow-lg"
                >
                    {matches.map((area, i) => (
                        <button
                            key={area}
                            type="button"
                            role="option"
                            aria-selected={i === highlight}
                            // mousedown, not click: fires before the input's blur
                            // closes the list, and preventDefault keeps focus.
                            onMouseDown={e => { e.preventDefault(); pick(area) }}
                            onMouseEnter={() => setHighlight(i)}
                            className="w-full min-h-11 md:min-h-10 px-3 rounded-lg text-left text-sm theme-text truncate cursor-pointer"
                            style={{ background: i === highlight ? "var(--ag-grid-hover-bg)" : "transparent" }}
                        >
                            {area}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
