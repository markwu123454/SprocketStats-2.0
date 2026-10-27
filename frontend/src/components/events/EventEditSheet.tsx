import { useEffect, type ReactNode } from "react"
import { X } from "lucide-react"

interface EventEditSheetProps {
    title: string
    onClose: () => void
    children: ReactNode
}

/** Bottom sheet for editing or creating an event: slides up over the page on
 *  a phone (tall, thumb-reachable, scrolls inside), and sits centered as a
 *  dialog from `md` up. */
export default function EventEditSheet({ title, onClose, children }: EventEditSheetProps) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
        window.addEventListener("keydown", onKey)
        const prevOverflow = document.body.style.overflow
        document.body.style.overflow = "hidden"
        return () => {
            window.removeEventListener("keydown", onKey)
            document.body.style.overflow = prevOverflow
        }
    }, [onClose])

    return (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
            <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
            <div
                role="dialog"
                aria-modal="true"
                aria-label={title}
                className="relative w-full md:max-w-lg max-h-[92dvh] flex flex-col rounded-t-2xl md:rounded-2xl border"
                style={{ background: "var(--theme-bg)", borderColor: "var(--theme-border)" }}
            >
                <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2 shrink-0">
                    <h2 className="text-base font-bold theme-h1-color truncate">{title}</h2>
                    <button
                        type="button"
                        aria-label="Close"
                        onClick={onClose}
                        className="w-11 h-11 -mr-2 inline-flex items-center justify-center rounded-lg outline-none focus:ring-2"
                    >
                        <X size={18} className="theme-subtext-color" />
                    </button>
                </div>
                <div className="overflow-y-auto overscroll-contain px-4 pt-2 pb-4" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
                    {children}
                </div>
            </div>
        </div>
    )
}
