import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react"
import { createPortal } from "react-dom"
import { Check, ChevronDown, GripHorizontal, X } from "lucide-react"
import { fuzzyFilter } from "@/lib/fuzzyMatch"
import { useIsMobile } from "@/lib/useIsMobile"

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
    searchable?: boolean
    searchPlaceholder?: string
    label?: string
    /** Mount with the menu already open. For "reveal a picker" flows where the
     *  control only appears *because* the user just asked for it — without
     *  this they'd have to click a second time to see the options. */
    defaultOpen?: boolean
    /** Fires whenever the menu opens or closes, including a dismissal with no
     *  selection. Lets a `defaultOpen` parent tear the picker back down when
     *  the user changes their mind, instead of stranding a closed one. */
    onOpenChange?: (open: boolean) => void
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
                                     searchable = false,
                                     searchPlaceholder = "Search…",
                                     label,
                                     defaultOpen = false,
                                     onOpenChange,
                                 }: DropdownProps) {
    const [open, setOpen] = useState(defaultOpen)
    const [highlighted, setHighlighted] = useState(0)
    const [menuHeight, setMenuHeight] = useState<number>(initialMaxHeight)
    const [query, setQuery] = useState("")
    // Whether the anchored (non-modal) menu should hang above the trigger
    // instead of below it -- computed once, at open time, from the
    // trigger's actual position (Fix 2). Never consulted in modal mode,
    // where the card is centered regardless.
    const [openUpward, setOpenUpward] = useState(false)

    const rootRef = useRef<HTMLDivElement>(null)
    const listRef = useRef<HTMLUListElement>(null)
    const searchInputRef = useRef<HTMLInputElement>(null)
    const isDragging = useRef(false)

    const isMobile = useIsMobile()

    const selectedIndex = options.findIndex(o => o.value === value)
    const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined
    const filteredOptions = searchable ? fuzzyFilter(options, query) : options

    // On mobile, an open menu renders as a centered portal modal instead of
    // an anchored dropdown (Fix 1). Desktop/tablet behavior is untouched.
    const modalMode = open && isMobile

    // Close menu when clicking outside -- anchored mode only. In modal mode
    // the menu is portaled to document.body, so it is never "inside
    // rootRef"; attaching this listener there would fire on every tap
    // inside the modal (including the search input) and slam it shut
    // immediately. The scrim's own onClick already handles dismissal for
    // the modal, so the listener is simply never attached while modalMode
    // is true.
    useEffect(() => {
        if (modalMode) return
        function onClickOutside(e: MouseEvent) {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
        }
        document.addEventListener("mousedown", onClickOutside)
        return () => document.removeEventListener("mousedown", onClickOutside)
    }, [modalMode])

    // Escape closes the modal even when focus never lands on an element
    // that already handles it (e.g. a non-searchable modal has no input to
    // catch the key via onKeyDown).
    useEffect(() => {
        if (!modalMode) return
        function onKey(e: globalThis.KeyboardEvent) {
            if (e.key === "Escape") setOpen(false)
        }
        document.addEventListener("keydown", onKey)
        return () => document.removeEventListener("keydown", onKey)
    }, [modalMode])

    // Reset the search query whenever the menu opens or closes
    useEffect(() => {
        if (searchable) setQuery("")
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open])

    // Reset the highlight whenever the query changes (list contents shift)
    useEffect(() => {
        if (searchable) setHighlighted(0)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query])

    // Autofocus the search input when the menu opens
    useEffect(() => {
        if (open && searchable) searchInputRef.current?.focus()
    }, [open, searchable])

    // A `defaultOpen` menu never went through `toggleOpen`, so nothing has
    // measured the trigger yet. Do it before paint, or a menu opening near the
    // bottom of the viewport renders downward for a frame and then jumps up.
    useLayoutEffect(() => {
        if (defaultOpen) computeFlip()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Report open/close outward. Notably fires on a dismissal with no
    // selection, which is what lets a `defaultOpen` parent unmount the picker
    // rather than leave a closed one sitting there -- reintroducing exactly
    // the second click `defaultOpen` exists to remove.
    useEffect(() => {
        onOpenChange?.(open)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open])

    // Center active item view on open
    useEffect(() => {
        if (!open) return
        const startIndex = Math.max(filteredOptions.findIndex(o => o.value === value), 0)
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
        const opt = filteredOptions[i]
        if (!opt) return
        onChange(opt.value)
        setOpen(false)
    }

    // Fix 2: measure the trigger at open time (not on every render) and
    // decide whether the anchored menu has room below it. Only meaningful
    // for anchored (non-modal) mode, but harmless to compute unconditionally
    // -- modal mode just never reads `openUpward`.
    function computeFlip() {
        const rect = rootRef.current?.getBoundingClientRect()
        if (!rect) return
        const viewportH = window.visualViewport?.height ?? window.innerHeight
        const spaceBelow = viewportH - rect.bottom
        const spaceAbove = rect.top
        setOpenUpward(spaceBelow < initialMaxHeight && spaceAbove > spaceBelow)
    }

    function toggleOpen() {
        if (!open) computeFlip()
        setOpen(o => !o)
    }

    function onKeyDown(e: KeyboardEvent) {
        if (disabled || options.length === 0) return
        if (!open) {
            if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault()
                computeFlip()
                setOpen(true)
            }
            return
        }
        if (e.key === "Escape") {
            e.preventDefault()
            setOpen(false)
        } else if (e.key === "ArrowDown") {
            e.preventDefault()
            setHighlighted(h => Math.min(h + 1, filteredOptions.length - 1))
        } else if (e.key === "ArrowUp") {
            e.preventDefault()
            setHighlighted(h => Math.max(h - 1, 0))
        } else if (e.key === "Enter") {
            e.preventDefault()
            selectIndex(highlighted)
        }
    }

    function renderRow(opt: DropdownOption, i: number, rowStyle: CSSProperties) {
        const isSelected = opt.value === value
        const isHighlighted = i === highlighted
        return (
            <li key={opt.value} role="option" aria-selected={isSelected}>
                <button
                    type="button"
                    onMouseEnter={() => !isDragging.current && setHighlighted(i)}
                    onClick={() => selectIndex(i)}
                    className="flex items-center justify-between gap-3 w-full px-3 text-sm text-left rounded-lg"
                    style={{
                        ...rowStyle,
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
    }

    const showMenu = open && !disabled && options.length > 0

    return (
        <div ref={rootRef} className={`relative ${className}`}>
            <button
                type="button"
                disabled={disabled || options.length === 0}
                onClick={toggleOpen}
                onKeyDown={onKeyDown}
                className={`flex items-center justify-between gap-2 w-full text-left transition-opacity disabled:cursor-not-allowed disabled:opacity-60 ${triggerClassName}`}
            >
                <span className="truncate">{selected ? selected.label : placeholder}</span>
                <ChevronDown
                    size={16}
                    className={`theme-subtext-color shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
                />
            </button>

            {showMenu && modalMode && createPortal(
                <div style={modalOverlayStyle} onClick={() => setOpen(false)}>
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label={label}
                        style={modalCardStyle}
                        onClick={e => e.stopPropagation()}
                    >
                        {label && (
                            <div style={modalHeaderRowStyle}>
                                <h2 style={modalTitleStyle}>{label}</h2>
                                <button type="button" onClick={() => setOpen(false)} aria-label="Close" style={modalCloseBtnStyle}>
                                    <X size={16} />
                                </button>
                            </div>
                        )}

                        {searchable && (
                            <div style={modalSearchWrapStyle} className="border-b theme-border">
                                <input
                                    ref={searchInputRef}
                                    type="text"
                                    value={query}
                                    onChange={e => setQuery(e.target.value)}
                                    onKeyDown={onKeyDown}
                                    placeholder={searchPlaceholder}
                                    className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-2 transition theme-bg theme-border theme-text"
                                />
                            </div>
                        )}

                        <ul
                            ref={listRef}
                            role="listbox"
                            className="flex-1 min-h-0 overflow-y-auto theme-scrollbar px-2 py-2"
                        >
                            {searchable && filteredOptions.length === 0 ? (
                                <li className="px-3 py-2 text-sm theme-subtext-color select-none" style={{ minHeight: 44, display: "flex", alignItems: "center" }}>
                                    No matches
                                </li>
                            ) : (
                                filteredOptions.map((opt, i) => renderRow(opt, i, { minHeight: 44 }))
                            )}
                        </ul>
                    </div>
                </div>,
                document.body
            )}

            {showMenu && !modalMode && (
                <div
                    className={`absolute z-50 rounded-xl border shadow-lg theme-border flex flex-col overflow-hidden ${menuAlign === "right" ? "right-0" : "left-0"} ${openUpward ? "bottom-full mb-1.5" : "top-full mt-1.5"}`}
                    style={{
                        background: "var(--theme-bg)",
                        width: "100%", // Forces menu to exact width of the parent card
                        height: resizable ? `${menuHeight}px` : "auto"
                    }}
                >
                    {searchable && (
                        <div className="w-full px-2 pt-2 pb-1 border-b theme-border shrink-0">
                            <input
                                ref={searchInputRef}
                                type="text"
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                onKeyDown={onKeyDown}
                                placeholder={searchPlaceholder}
                                className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-2 transition theme-bg theme-border theme-text"
                            />
                        </div>
                    )}
                    <ul
                        ref={listRef}
                        role="listbox"
                        className="w-full flex-1 overflow-y-auto theme-scrollbar px-1 py-1"
                        style={{ maxHeight: resizable ? "none" : `${initialMaxHeight}px` }}
                    >
                        {searchable && filteredOptions.length === 0 ? (
                            <li className="px-3 py-2 text-sm theme-subtext-color select-none">No matches</li>
                        ) : (
                            filteredOptions.map((opt, i) => renderRow(opt, i, { paddingTop: 8, paddingBottom: 8 }))
                        )}
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

// ── Mobile modal styles (Fix 1) ─────────────────────────────────────────
// All colors come from `--theme-*` tokens (see .design-sync/conventions.md)
// so the modal reads correctly under every season palette, including the
// light cream theme-2026.

const modalOverlayStyle: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 60,
    height: "var(--real-vh, 100dvh)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,.55)",
}

const modalCardStyle: CSSProperties = {
    width: "calc(100% - 32px)",
    maxWidth: 380,
    maxHeight: "calc(var(--real-vh, 100dvh) - 32px)",
    borderRadius: 20,
    background: "var(--theme-bg)",
    border: "1px solid var(--theme-border)",
    boxShadow: "0 16px 48px rgba(0,0,0,.5)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
}

const modalHeaderRowStyle: CSSProperties = {
    flex: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "14px 14px 8px",
}

const modalTitleStyle: CSSProperties = {
    margin: 0,
    fontSize: 17,
    fontWeight: 700,
    color: "var(--theme-h1-color)",
}

const modalCloseBtnStyle: CSSProperties = {
    flex: "none",
    width: 36,
    height: 36,
    borderRadius: 999,
    border: "1px solid var(--theme-border)",
    background: "transparent",
    color: "var(--theme-subtext-color)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
}

const modalSearchWrapStyle: CSSProperties = {
    flex: "none",
    width: "100%",
    padding: "10px 14px",
}
