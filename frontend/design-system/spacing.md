# Spacing

The base unit is Tailwind's 4px scale.

| Alias | Step | px | Use |
|---|---|---|---|
| `space-xs` | `1` | 4 | Icon to label |
| `space-sm` | `2` | 8 | Between buttons, label to input |
| `space-md` | `3` | 12 | Footer vertical padding, rows |
| `space-base` | `4` | 16 | Between fields, mobile gutter |
| `space-lg` | `5` | 20 | Card padding |
| `space-page` | `6` | 24 | Web gutter, between sections |
| `space-xl` | `8` | 32 | Major page groups |

## Layout by breakpoint

| Area | Web | Mobile |
|---|---|---|
| Page gutter | `px-6` | `px-4` |
| Field gap | `gap-4` | `gap-4` |
| Dialog or sheet padding | `p-6` | `px-4` |
| Single-column form width | `max-w-2xl` | Full width |
| Sheet width | Not used | Full width up to `md` |
| Bottom inset | None | Add `env(safe-area-inset-bottom)` to the lowest bar |

## Decisions

- **Content never sits directly on the season background.** Only the `h1`, its subtitle and page tabs may; everything else is on a card (`rounded-xl border theme-border theme-bg`, `p-5`). Form pages are one centred `max-w-2xl` card with `gap-4`, an internal `border-t` between groups and the `FormFooter` as its flush last child.
- **A page never scrolls sideways at any width.** Wide content (AG Grid, tables, tab strips) scrolls inside its own container; `html` and `body` use `overflow-x: clip` (not `hidden`, which would break sticky footers) and the app shell's content column is `min-w-0`. Below `md`, rows with several fixed controls wrap to a second line instead of squeezing the text.
- **Add 16 and 24 as named steps.** The old scale jumped from 12 to 20, yet `gap-4` and
  `px-4` are common in the code and are what a form needs.
- **Gutters follow Material 3's window sizes:** 16px on compact and 24px on expanded.
- **Only the lowest bar handles the safe area.** When a sheet owns the inset and its footer
  sticks inside it, content can show beneath the footer. The footer should own it.
- **Sheets span the full width below `md`.** The 430px cap at `TasksPageMobile.tsx:957`
  leaves side gaps on landscape phones and small tablets, and no other sheet has it.
- **Pixel-tuned values stay allowed only in auth hero layouts.**

## Remaining debt

- `TasksPageDesktop.tsx` `TaskRow` and its panels still use inline pixel `gap` and `padding` (3, 5, 6, 9, 10, 17, 24, 28px) that are off the 4px scale. They define the row's fixed geometry, so moving them changes the layout, not just the classes. `TasksPageMobile.tsx` has fewer, for the same reason.
