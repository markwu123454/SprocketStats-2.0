# Color

Use semantic roles, never raw hex or Tailwind palette classes. Roles resolve per season
through `.theme-2025`, `.theme-2026` and `.theme-2027` in `src/index.css`.

## Roles (web and mobile are identical)

| Role | Token | Use |
|---|---|---|
| Surface | `--theme-bg` | Panels, sheets, dialogs, footers, Filled button label |
| Raised surface | `--theme-button-bg` / `--theme-button-hover` | Hero panels, hover fills |
| Text | `--theme-text` | Body copy |
| Emphasis | `--theme-h1-color` | Headings, field labels |
| Muted | `--theme-subtext-color` | Helper text, timestamps, placeholders |
| Accent | `--theme-text-contrast` | Filled buttons, links, selection, focus ring |
| Divider | `--theme-border` | Decorative lines between surfaces |
| **Outline (new)** | `--theme-outline` | Boundaries of inputs, checkboxes, Outlined buttons |
| **Danger (new)** | `--theme-danger` | Error text, destructive actions |

Tints use `color-mix(in oklch, var(--role) N%, transparent)`. The scrim is
`rgba(0,0,0,.5)`. AG Grid uses its own `--ag-grid-*` roles.

## Measured contrast

| Pair | 2025 | 2026 | 2027 | Target |
|---|---|---|---|---|
| Text on surface | 15.36 | 12.52 | 13.20 | 4.5 |
| Muted on surface | 10.39 | 8.28 | 8.06 | 4.5 |
| Accent on surface | 8.52 | 5.27 | 9.90 | 4.5 |
| `--theme-border` on surface | **1.72** | **1.28** | **2.04** | 3.0 for controls |
| `--theme-outline` on surface | 4.18 | 3.32 | 4.58 | 3.0 for controls |
| `#dc2626` on surface | **3.18** | 4.50 | **2.97** | 4.5 |
| `--theme-danger` on surface | 8.09 | 6.02 | 7.56 | 4.5 |

Bold values fail their target.

## Decisions

- **Danger is one hue with a per-season tone.** The earlier doc fixed danger at `#dc2626`
  in every season, but that fails AA on both dark seasons. Tones are `#fca5a5` on 2025 and
  2027 and `#b91c1c` on 2026. Material 3 does the same with its error role, and an error
  still reads as red everywhere.
- **Outline is separate from border.** `--theme-border` fails the 3:1 that WCAG 1.4.11 asks
  of control boundaries, but raising it would make every card and divider heavier. This
  mirrors Material 3's `outline` and `outline-variant`.
- **We keep season palettes rather than adopting M3 tonal roles.** The seasons are the
  product's identity, and a full tonal scale would add dozens of unused tokens.

## Migration

- Replace the two `DANGER_RED` constants: `src/lib/taskFormat.ts:8`, `src/pages/DashboardPage.tsx:19`.
- Replace Tailwind palette reds and other palette classes (`rg "text-red-|bg-red-" src`).
- Move input and checkbox boundaries from `theme-border` to `--theme-outline`.
