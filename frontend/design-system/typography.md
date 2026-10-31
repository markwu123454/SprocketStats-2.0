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
- **Tab labels rise from 10px to 11px.** Material 3 uses 12px. At 11px "Control Panel" (about 74px) does
  not fit one line in a fifth of a 340px phone (68px), so labels have no tracking or cell padding and wrap to
  two centred lines with tight leading rather than clip.
- **`display` and `h1` stay disjoint:** hero surfaces and interior screens respectively.

## Remaining debt

- Inline `fontSize` / `fontWeight` that the named scale cannot express: `HelpTip.tsx` (10px glyph), `taskFormat.ts` `CRITICAL_BADGE_STYLE` (11px, weight 800), `Avatar.tsx` (size-relative initials), `agGridTheme.ts` (13px grid text). Calendar day cells in `AttendancePage.tsx` and `MeetingHoursEditor.tsx`, and the status menu in `TasksPageDesktop.tsx`, set weight inline (the menu also sets `font: inherit`, which would override a class).
- `LegalPageLayout.tsx` uses a marketing scale (`text-4xl`/`6xl`) on purpose, like the auth hero.
