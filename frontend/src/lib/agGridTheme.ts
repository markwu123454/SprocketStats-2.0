import { themeQuartz, provideGlobalGridOptions } from "ag-grid-community"

/**
 * A single AG Grid theme, applied globally to every grid in the app.
 *
 * Rather than hard-coding one season's palette, every colour parameter points
 * at a CSS custom property. Those properties are (re)defined per season by the
 * `.theme-2025 / .theme-2026 / .theme-2027` classes on <html> (see index.css),
 * so switching the seasonal theme automatically re-themes every grid live — no
 * per-grid props and no remount required.
 *
 * The `--ag-grid-*` variables are grid-specific tuning knobs defined alongside
 * the seasonal palettes in index.css; the rest reuse the existing `--theme-*`
 * design tokens so the grids stay in lock-step with the surrounding UI.
 */
const seasonalGridTheme = themeQuartz.withParams({
    // Surface + text
    backgroundColor:            "var(--theme-bg)",
    foregroundColor:            "var(--theme-text)",
    chromeBackgroundColor:      "var(--ag-grid-chrome-bg)",
    borderColor:                "var(--theme-border)",

    // Header
    headerBackgroundColor:      "var(--ag-grid-header-bg)",
    headerTextColor:            "var(--theme-h1-color)",
    headerFontWeight:           600,
    headerColumnResizeHandleColor: "var(--theme-border)",
    headerColumnBorder:         { color: "var(--theme-border)" },

    // Rows
    oddRowBackgroundColor:      "var(--ag-grid-odd-row-bg)",
    rowHoverColor:              "var(--ag-grid-hover-bg)",
    selectedRowBackgroundColor: "var(--ag-grid-selected-bg)",
    rowBorder:                  { color: "var(--ag-grid-row-border)" },

    // Accents / interaction
    accentColor:                "var(--theme-text-contrast)",
    rangeSelectionBorderColor:  "var(--theme-text-contrast)",
    inputFocusBorder:           { color: "var(--theme-text-contrast)" },

    // Secondary text (tool panel, menus, no-rows overlay, etc.)
    textColor:                  "var(--theme-text)",

    // Shape + type — the surrounding container already supplies a rounded
    // border, so the wrapper stays borderless & square to blend seamlessly.
    wrapperBorder:              false,
    wrapperBorderRadius:        0,
    borderRadius:               6,
    fontFamily:                 "inherit",
    fontSize:                   13,
    headerFontSize:             13,
    cellHorizontalPadding:      14,
    rowHeight:                  44,
    headerHeight:               46,
})

/**
 * Apply the theme to every AgGridReact instance in the app.
 * Imported once from main.tsx so it runs before any grid mounts.
 */
provideGlobalGridOptions({
    theme: seasonalGridTheme,
})

export default seasonalGridTheme
