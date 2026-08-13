import { useState } from "react"
import { useEventContext } from "@/contexts/eventContext"

export default function PackingPage() {
    const { info, loading } = useEventContext()
    const [checked, setChecked] = useState<Set<string>>(new Set())

    if (loading) return <PageState>Loading…</PageState>

    const hasPacking     = (info?.packing_list?.length ?? 0) > 0
    const hasInstructions = (info?.instructions?.length ?? 0) > 0
    if (!hasPacking && !hasInstructions) return <PageState>Packing info not yet posted.</PageState>

    function toggle(id: string) {
        setChecked(prev => {
            const next = new Set(prev)
            next.has(id) ? next.delete(id) : next.add(id)
            return next
        })
    }

    return (
        <div className="max-w-xl mx-auto px-4 py-6 flex flex-col gap-8">

            {/* Packing list */}
            {hasPacking && (
                <section>
                    <h2
                        className="text-[11px] font-bold tracking-wider uppercase mb-4"
                        style={{ color: "var(--theme-subtext-color)" }}
                    >
                        Packing List
                    </h2>
                    <div className="flex flex-col gap-3">
                        {info!.packing_list!.map(({ category, items }) => (
                            <div
                                key={category}
                                className="rounded-xl border px-4 py-3"
                                style={{ background: "var(--theme-bg)", borderColor: "var(--theme-border)" }}
                            >
                                <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--theme-text)" }}>
                                    {category}
                                </h3>
                                <div className="flex flex-col gap-2">
                                    {items.map(item => {
                                        const id   = `${category}:${item}`
                                        const done = checked.has(id)
                                        return (
                                            <label key={id} className="flex items-center gap-2.5 cursor-pointer">
                                                <input type="checkbox" checked={done} onChange={() => toggle(id)} className="sr-only" />
                                                <div
                                                    className="w-4 h-4 rounded border shrink-0 flex items-center justify-center transition-colors"
                                                    style={{
                                                        background:  done ? "var(--theme-text-contrast)" : "var(--theme-bg)",
                                                        borderColor: done ? "var(--theme-text-contrast)" : "var(--theme-border)",
                                                    }}
                                                >
                                                    {done && (
                                                        <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                                                            <path d="M1 4l2.5 2.5L9 1" stroke="var(--theme-bg)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                                        </svg>
                                                    )}
                                                </div>
                                                <span
                                                    className="text-sm transition-opacity"
                                                    style={{
                                                        color:          done ? "var(--theme-subtext-color)" : "var(--theme-text)",
                                                        opacity:        done ? 0.5 : 1,
                                                        textDecoration: done ? "line-through" : "none",
                                                    }}
                                                >
                                                    {item}
                                                </span>
                                            </label>
                                        )
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {/* Instructions */}
            {hasInstructions && (
                <section>
                    <h2
                        className="text-[11px] font-bold tracking-wider uppercase mb-4"
                        style={{ color: "var(--theme-subtext-color)" }}
                    >
                        Instructions
                    </h2>
                    <div className="flex flex-col gap-4">
                        {info!.instructions!.map(({ heading, body }) => (
                            <div key={heading}>
                                <h3 className="text-sm font-semibold mb-1" style={{ color: "var(--theme-text)" }}>
                                    {heading}
                                </h3>
                                <p className="text-sm leading-relaxed" style={{ color: "var(--theme-subtext-color)" }}>
                                    {body}
                                </p>
                            </div>
                        ))}
                    </div>
                </section>
            )}
        </div>
    )
}

function PageState({ children }: { children: string }) {
    return (
        <div className="flex items-center justify-center py-16">
            <span className="text-sm" style={{ color: "var(--theme-subtext-color)" }}>{children}</span>
        </div>
    )
}
