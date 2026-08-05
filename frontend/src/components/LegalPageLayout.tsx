import {useEffect, type ReactNode} from "react"
import {ArrowLeft, ExternalLink, Mail} from "lucide-react"
import {Link} from "react-router-dom"
import {useAppReady} from "@/contexts/appReadyContext"

export type LegalSection = {
    id: string
    title: string
    content: ReactNode
}

type LegalPageLayoutProps = {
    eyebrow: string
    title: string
    summary: string
    effectiveDate: string
    lastUpdated?: string
    contactEmail?: string
    sections: LegalSection[]
    activePage: "privacy" | "terms"
}

const REPO_URL = "https://github.com/markwu123454/SprocketStats-2.0"

export default function LegalPageLayout({
    eyebrow,
    title,
    summary,
    effectiveDate,
    lastUpdated,
    contactEmail = "me@markwu.org",
    sections,
    activePage,
}: LegalPageLayoutProps) {
    const markReady = useAppReady()

    useEffect(() => {
        const previousTitle = document.title
        document.title = `${title} | SprocketStats`
        markReady()
        return () => { document.title = previousTitle }
    }, [markReady, title])

    return (
        <div className="relative h-full overflow-y-auto overscroll-y-contain theme-scrollbar theme-button-bg theme-text">
            <div
                aria-hidden="true"
                className="pointer-events-none fixed inset-0 opacity-25"
                style={{
                    background: `
                        radial-gradient(circle at 12% 0%, color-mix(in srgb, var(--theme-text-contrast) 18%, transparent), transparent 28rem),
                        radial-gradient(circle at 95% 28%, color-mix(in srgb, var(--theme-border) 42%, transparent), transparent 32rem)
                    `,
                }}
            />

            <header className="sticky top-0 z-20 border-b theme-border backdrop-blur-xl bg-[color-mix(in_srgb,var(--theme-button-bg)_88%,transparent)]">
                <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
                    <Link to="/" className="group flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4">
                        <span
                            aria-hidden="true"
                            className="block h-8 w-8 transition-transform duration-300 group-hover:rotate-12"
                            style={{
                                backgroundColor: "var(--theme-h1-color)",
                                mask: "url(/sprocket_logo_gear.svg) center/contain no-repeat",
                                WebkitMask: "url(/sprocket_logo_gear.svg) center/contain no-repeat",
                            }}
                        />
                        <span className="font-semibold tracking-tight theme-h1-color">SprocketStats</span>
                    </Link>

                    <nav aria-label="Legal pages" className="flex items-center gap-1 rounded-xl border theme-border p-1 text-sm">
                        <Link
                            to="/privacy"
                            aria-current={activePage === "privacy" ? "page" : undefined}
                            className={`rounded-lg px-3 py-1.5 font-medium transition-opacity ${activePage === "privacy" ? "theme-bg theme-h1-color" : "theme-subtext-color hover:opacity-75"}`}
                        >
                            Privacy
                        </Link>
                        <Link
                            to="/terms"
                            aria-current={activePage === "terms" ? "page" : undefined}
                            className={`rounded-lg px-3 py-1.5 font-medium transition-opacity ${activePage === "terms" ? "theme-bg theme-h1-color" : "theme-subtext-color hover:opacity-75"}`}
                        >
                            Terms
                        </Link>
                    </nav>
                </div>
            </header>

            <main className="relative z-10 mx-auto max-w-6xl px-5 pb-16 pt-12 sm:px-8 sm:pt-18">
                <div className="max-w-3xl">
                    <Link
                        to="/"
                        className="mb-9 inline-flex items-center gap-2 text-sm font-semibold theme-text-contrast transition-opacity hover:opacity-75"
                    >
                        <ArrowLeft size={16} aria-hidden="true" />
                        Back to sign in
                    </Link>

                    <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] theme-text-contrast">{eyebrow}</p>
                    <h1 className="text-4xl font-bold tracking-[-0.035em] theme-h1-color sm:text-6xl">{title}</h1>
                    <p className="mt-6 max-w-2xl text-base leading-7 theme-subtext-color sm:text-lg sm:leading-8">{summary}</p>
                    <div className="mt-5 flex flex-wrap gap-2 text-xs font-medium theme-subtext-color">
                        <p className="inline-flex rounded-full border theme-border px-3 py-1.5">
                            Effective {effectiveDate}
                        </p>
                        {lastUpdated && (
                            <p className="inline-flex rounded-full border theme-border px-3 py-1.5">
                                Last updated {lastUpdated}
                            </p>
                        )}
                    </div>
                </div>

                <div className="mt-14 grid items-start gap-10 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-16">
                    <aside className="hidden lg:block lg:sticky lg:top-24">
                        <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em] theme-subtext-color">On this page</p>
                        <nav aria-label="Page contents">
                            <ol className="space-y-1 border-l theme-border">
                                {sections.map((section, index) => (
                                    <li key={section.id}>
                                        <a
                                            href={`#${section.id}`}
                                            className="-ml-px flex gap-3 border-l border-transparent py-2 pl-4 text-sm theme-subtext-color transition-opacity hover:border-[var(--theme-text-contrast)] hover:opacity-75"
                                        >
                                            <span className="font-mono text-[11px] opacity-55">{String(index + 1).padStart(2, "0")}</span>
                                            <span>{section.title}</span>
                                        </a>
                                    </li>
                                ))}
                            </ol>
                        </nav>
                    </aside>

                    <article className="min-w-0">
                        {sections.map((section, index) => (
                            <section
                                id={section.id}
                                key={section.id}
                                className="scroll-mt-28 border-t theme-border py-9 first:border-t-0 first:pt-0 sm:py-11"
                            >
                                <div className="mb-5 flex items-baseline gap-4">
                                    <span aria-hidden="true" className="font-mono text-xs theme-text-contrast opacity-70">
                                        {String(index + 1).padStart(2, "0")}
                                    </span>
                                    <h2 className="text-xl font-bold tracking-tight theme-h1-color sm:text-2xl">{section.title}</h2>
                                </div>
                                <div className="legal-copy pl-0 sm:pl-10">{section.content}</div>
                            </section>
                        ))}
                    </article>
                </div>
            </main>

            <footer className="relative z-10 border-t theme-border">
                <div className="mx-auto grid max-w-6xl gap-6 px-5 py-8 text-xs theme-subtext-color sm:px-8 md:grid-cols-[1fr_auto] md:items-end">
                    <div>
                        <p className="font-semibold theme-h1-color">SprocketStats</p>
                        <p className="mt-1 max-w-xl leading-5 opacity-75">
                            Open source scouting and team operations for FRC teams. Developed by the Team Sprocket (FRC 3473) Scouting Subteam.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-x-5 gap-y-2 md:justify-end">
                        <a href={`mailto:${contactEmail}`} className="inline-flex items-center gap-1.5 font-medium hover:opacity-75">
                            <Mail size={13} aria-hidden="true" /> Contact
                        </a>
                        <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-medium hover:opacity-75">
                            Source <ExternalLink size={12} aria-hidden="true" />
                        </a>
                    </div>
                </div>
            </footer>
        </div>
    )
}
