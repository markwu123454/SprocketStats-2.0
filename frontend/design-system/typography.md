# Typography

System stack through `font-sans`, with `font-mono` for badges. There is no webfont, so
text renders immediately on slow networks.

| Token | Classes | Web | Mobile |
|---|---|---|---|
| `display` | `text-[32px] font-semibold tracking-[-0.01em]` | Auth hero | Auth hero |
| `h1` | `text-2xl font-bold` | Screen title | Screen title |
| `h2` | `text-xs font-semibold uppercase tracking-widest` | Section label | Section label |
| `title` | `text-lg font-semibold` | Card, dialog title | Card, sheet, dialog title |
| `body` | `text-sm` | Default copy | Default copy |
| `input` | `text-base md:text-sm` | 14px | 16px |
| `label` | `text-sm font-semibold` | Field label | Field label |
| `caption` | `text-xs` | Helper, error text | Helper, error text |
| `micro` | `text-[11px]` | Legal only | Legal only |
| `badge` | `font-mono text-[11px] uppercase tracking-[0.14em]` | Season, time tags | Season, time tags |
| `nav-label` | `text-[11px] font-medium` | Not used | Tab bar label |

## Decisions

- **Mobile inputs are 16px.** iOS zooms the page when focusing a smaller input. The zoom
  lock in `index.html:5` hides that problem but fails WCAG 1.4.4. `MembersPage.tsx:96`
  already uses this pattern; extending it lets us remove the lock.
- **All modal titles use `title`.** Today they vary: `text-base font-bold`, 19px inline,
  `text-sm` in accent, and `text-lg`. One style makes sheets and dialogs read as a family.
- **Tab labels rise from 10px to 11px.** Material 3 uses 12px, but "Control Panel" needs to
  fit a fifth of a 360px phone. 11px is the largest size that leaves it room.
- **`display` and `h1` stay disjoint:** hero surfaces and interior screens respectively.

## Migration

- Replace inline `fontSize` in `TasksPageMobile.tsx` and `TasksPageDesktop.tsx`, such as `sheetTitleStyle` at `TasksPageMobile.tsx:963`.
- Apply `input` to every text field, then remove the zoom lock.
