// design-sync entry: the explicit public surface of the SprocketStats UI kit.
//
// Why this file exists: `frontend` is a Vite application, not a published
// library — there is no `dist/` library build and no `.d.ts` tree for the
// converter to read. The converter's fallback (`export *` over every src file)
// would miss `Dropdown` entirely, because it is a *default* export.
//
// Keep this list in sync with `componentSrcMap` in `.design-sync/config.json`.

export { default as Dropdown } from '../src/components/ui/Dropdown'
export type { DropdownOption } from '../src/components/ui/Dropdown'

export { TimeWheel } from '../src/components/ui/TimeWheel'

/**
 * Season theme shell — the wrapper every SprocketStats component needs.
 *
 * Every component reads its colors from `--theme-*` custom properties, and
 * those are only defined inside a `.theme-2025` / `.theme-2026` / `.theme-2027`
 * scope. Rendering a component outside one of these produces unstyled,
 * near-invisible output.
 *
 * In the running app this scope comes from `src/contexts/themeProvider.tsx`,
 * which puts the class on `<html>` and persists the choice to localStorage.
 * This shell applies the same class to a plain element instead — the theme CSS
 * is class-scoped, not `:root`-scoped, so either placement works, and a local
 * element keeps a rendered design self-contained. `theme-2027` matches the
 * app's own DEFAULT_THEME.
 */
export function ThemeShell({
  season = 'theme-2027',
  children,
}: {
  season?: 'theme-2025' | 'theme-2026' | 'theme-2027'
  children?: React.ReactNode
}) {
  return (
    <div
      className={season}
      style={{
        background: 'var(--theme-bg)',
        color: 'var(--theme-text)',
        padding: '1.5rem',
        minHeight: '100%',
        boxSizing: 'border-box',
      }}
    >
      {children}
    </div>
  )
}
