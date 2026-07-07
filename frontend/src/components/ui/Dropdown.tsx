import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { Check, ChevronDown, GripHorizontal } from "lucide-react"

export interface DropdownOption {
    value: string
    label: string
}

interface DropdownProps {
    value: string
    options: DropdownOption[]
    onChange: (value: string) => void
    disabled?: boolean
    placeholder?: string
    className?: string
    triggerClassName?: string
    menuAlign?: "left" | "right"
    resizable?: boolean
    initialMaxHeight?: number
}

export default function Dropdown({
                                     value,
                                     options,
                                     onChange,
                                     disabled = false,
                                     placeholder = "Select…",
                                     className = "",
                                     triggerClassName = "",
                                     menuAlign = "left",
                                     resizable = false,
                                     initialMaxHeight = 256,
                                 }: DropdownProps) {
    const [open, setOpen] = useState(false)
    const [highlighted, setHighlighted] = useState(0)
    const [menuHeight, setMenuHeight] = useState<number>(initialMaxHeight)

    const rootRef = useRef<HTMLDivElement>(null)
    const listRef = useRef<HTMLUListElement>(null)
    const isDragging = useRef(false)

    const selectedIndex = options.findIndex(o => o.value === value)
    const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined

    // Close menu when clicking outside
    useEffect(() => {
        function onClickOutside(e: MouseEvent) {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
        }
        document.addEventListener("mousedown", onClickOutside)
        return () => document.removeEventListener("mousedown", onClickOutside)
    }, [])

    // Center active item view on open
    useEffect(() => {
        if (!open) return
        const startIndex = Math.max(selectedIndex, 0)
        setHighlighted(startIndex)
        const el = listRef.current?.children[startIndex] as HTMLElement | undefined
        const list = listRef.current
        if (el && list) list.scrollTop = el.offsetTop - list.clientHeight / 2 + el.clientHeight / 2
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open])

    // Drag resize handler
    const startResize = (e: React.MouseEvent) => {
        e.preventDefault()
        if (!listRef.current) return

        isDragging.current = true
        const startY = e.clientY
        const startHeight = listRef.current.parentElement ? listRef.current.parentElement.getBoundingClientRect().height : menuHeight

        const doResize = (moveEvent: MouseEvent) => {
            if (!isDragging.current) return
            const deltaY = moveEvent.clientY - startY
            // Constrain dropdown list between 120px and 600px tall
            const newHeight = Math.max(120, Math.min(600, startHeight + deltaY))
            setMenuHeight(newHeight)
        }

        const stopResize = () => {
            isDragging.current = false
            document.removeEventListener("mousemove", doResize)
            document.removeEventListener("mouseup", stopResize)
        }

        document.addEventListener("mousemove", doResize)
        document.addEventListener("mouseup", stopResize)
    }

    function selectIndex(i: number) {
        const opt = options[i]
        if (!opt) return
        onChange(opt.value)
        setOpen(false)
    }

    function onKeyDown(e: KeyboardEvent) {
        if (disabled || options.length === 0) return
        if (!open) {
            if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault()
                setOpen(true)
            }
            return
        }
        if (e.key === "Escape") {
            e.preventDefault()
            setOpen(false)
        } else if (e.key === "ArrowDown") {
            e.preventDefault()
            setHighlighted(h => Math.min(h + 1, options.length - 1))
        } else if (e.key === "ArrowUp") {
            e.preventDefault()
            setHighlighted(h => Math.max(h - 1, 0))
        } else if (e.key === "Enter") {
            e.preventDefault()
            selectIndex(highlighted)
        }
    }

    return (
        <div ref={rootRef} className={`relative ${className}`}>
            <button
                type="button"
                disabled={disabled || options.length === 0}
                onClick={() => setOpen(o => !o)}
                onKeyDown={onKeyDown}
                className={`flex items-center justify-between gap-2 w-full text-left transition-opacity disabled:cursor-not-allowed disabled:opacity-60 ${triggerClassName}`}
            >
                <span className="truncate">{selected ? selected.label : placeholder}</span>
                <ChevronDown
                    size={16}
                    className={`theme-subtext-color shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
                />
            </button>

            {open && !disabled && options.length > 0 && (
                <div
                    className={`absolute z-50 mt-1.5 rounded-xl border shadow-lg theme-border flex flex-col overflow-hidden ${menuAlign === "right" ? "right-0" : "left-0"}`}
                    style={{
                        background: "var(--theme-bg)",
                        width: "100%", // Forces menu to exact width of the parent card
                        height: resizable ? `${menuHeight}px` : "auto"
                    }}
                >
                    <ul
                        ref={listRef}
                        role="listbox"
                        className="w-full flex-1 overflow-y-auto theme-scrollbar px-1 py-1"
                        style={{ maxHeight: resizable ? "none" : `${initialMaxHeight}px` }}
                    >
                        {options.map((opt, i) => {
                            const isSelected = opt.value === value
                            const isHighlighted = i === highlighted
                            return (
                                <li key={opt.value} role="option" aria-selected={isSelected}>
                                    <button
                                        type="button"
                                        onMouseEnter={() => !isDragging.current && setHighlighted(i)}
                                        onClick={() => selectIndex(i)}
                                        className="flex items-center justify-between gap-3 w-full px-3 py-2 text-sm text-left rounded-lg"
                                        style={{
                                            background: isHighlighted
                                                ? "color-mix(in oklch, var(--theme-button-bg) 90%, transparent)"
                                                : "transparent",
                                            color: isSelected ? "var(--theme-text-contrast)" : "var(--theme-text)",
                                            fontWeight: isSelected ? 600 : 500,
                                        }}
                                    >
                                        <span className="truncate">{opt.label}</span>
                                        {isSelected && <Check size={14} className="shrink-0" />}
                                    </button>
                                </li>
                            )
                        })}
                    </ul>

                    {resizable && (
                        <div
                            onMouseDown={startResize}
                            className="w-full h-4 flex items-center justify-center cursor-ns-resize border-t theme-border select-none hover:bg-black/5 dark:hover:bg-white/5 rounded-b-xl transition-colors shrink-0"
                        >
                            <GripHorizontal size={12} className="opacity-40" />
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}