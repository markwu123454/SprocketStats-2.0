import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react"
import { Check, ChevronDown, GripHorizontal } from "lucide-react"
import Sheet from "@/components/ui/Sheet"
import { fuzzyFilter } from "@/lib/fuzzyMatch"
import { useIsMobile } from "@/lib/useIsMobile"
import { focusRing, inputClass, menuRowClass } from "@/lib/uiClasses"

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

    // On mobile, an open menu renders as a drag Sheet (portaled to body)
    // instead of an anchored dropdown. Desktop/tablet behavior is untouched.
    const modalMode = open && isMobile

    // Close menu when clicking outside -- anchored mode only. In modal mode
    // the menu is portaled to document.body, so it is never "inside"
    // rootRef; attaching this listener there would fire on every tap
    // inside the sheet (including the search input) and slam it shut
    // immediately. The Sheet's scrim already handles dismissal, so the
    // listener is simply never attached while modalMode is true.
    useEffect(() => {
        if (modalMode) return
        function onClickOutside(e: MouseEvent) {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
        }
        document.addEventListener("mousedown", onClickOutside)
        return () => document.removeEventListener("mousedown", onClickOutside)
    }, [modalMode])

    // Escape in modal mode is handled by the Sheet (it is the topmost overlay,
    // and listens even when focus is elsewhere) and by onKeyDown below while
    // the search input has focus.

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
        if (el && list) {
            // In a Sheet the scroller is the Sheet's content area, not the <ul> itself.
            const scroller = list.closest<HTMLElement>("[data-sheet-scroller]")
            if (scroller) {
                const offset = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top
                scroller.scrollTop += offset - scroller.clientHeight / 2 + el.clientHeight / 2
            } else {
                list.scrollTop = el.offsetTop - list.clientHeight / 2 + el.clientHeight / 2
            }
        }
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

    function renderRow(opt: DropdownOption, i: number) {
        const isSelected = opt.value === value
        const isHighlighted = i === highlighted
        return (
            <li key={opt.value} role="option" aria-selected={isSelected}>
                <button
                    type="button"
                    onMouseEnter={() => !isDragging.current && setHighlighted(i)}
                    onClick={() => selectIndex(i)}
                    className={`${menuRowClass} ${isSelected ? "font-semibold" : "font-medium"}`}
                    style={{
                        background: isHighlighted
                            ? "color-mix(in oklch, var(--theme-button-bg) 90%, transparent)"
                            : "transparent",
                        color: isSelected ? "var(--theme-text-contrast)" : "var(--theme-text)",
                    }}
                >
                    <span className="truncate">{opt.label}</span>
                    {isSelected && <Check size={16} className="shrink-0" />}
                </button>
            </li>
        )
    }

    const noMatches = "flex items-center min-h-12 md:min-h-10 px-3 text-sm theme-subtext-color select-none"

    const showMenu = open && !disabled && options.length > 0

    return (
        <div ref={rootRef} className={`relative ${className}`}>
            <button
                type="button"
                disabled={disabled || options.length === 0}
                onClick={toggleOpen}
                onKeyDown={onKeyDown}
                className={`flex items-center justify-between gap-2 w-full text-left transition-opacity disabled:cursor-not-allowed disabled:opacity-40 ${focusRing} ${triggerClassName}`}
            >
                <span className="truncate">{selected ? selected.label : placeholder}</span>
                <ChevronDown
                    size={16}
                    className={`theme-subtext-color shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
                />
            </button>

            {showMenu && modalMode && (
                <Sheet
                    kind={searchable ? "form" : "menu"}
                    title={label ?? "Choose an option"}
                    labelledByTitleHidden={!label}
                    onClose={() => setOpen(false)}
                    className="px-2 pb-2"
                >
                    {searchable && (
                        <div className="sticky top-0 z-10 theme-bg px-2 pt-2 pb-2">
                            <input
                                ref={searchInputRef}
                                type="text"
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                onKeyDown={onKeyDown}
                                placeholder={searchPlaceholder}
                                className={`w-full ${inputClass}`}
                            />
                        </div>
                    )}
                    <ul ref={listRef} role="listbox" className={searchable ? "" : "pt-2"}>
                        {searchable && filteredOptions.length === 0 ? (
                            <li className={noMatches}>No matches</li>
                        ) : (
                            filteredOptions.map((opt, i) => renderRow(opt, i))
                        )}
                    </ul>
                </Sheet>
            )}

            {showMenu && !modalMode && (
                <div
                    className={`absolute z-40 rounded-xl border shadow-lg theme-border flex flex-col overflow-hidden ${menuAlign === "right" ? "right-0" : "left-0"} ${openUpward ? "bottom-full mb-1.5" : "top-full mt-1.5"}`}
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
                                className={`w-full ${inputClass}`}
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
                            <li className={noMatches}>No matches</li>
                        ) : (
                            filteredOptions.map((opt, i) => renderRow(opt, i))
                        )}
                    </ul>

                    {resizable && (
                        <div
                            onMouseDown={startResize}
                            className="w-full h-4 flex items-center justify-center cursor-ns-resize border-t theme-border select-none hover:bg-[color-mix(in_oklch,var(--theme-text)_8%,transparent)] rounded-b-xl transition-colors shrink-0"
                        >
                            <GripHorizontal size={14} className="opacity-40" />
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
