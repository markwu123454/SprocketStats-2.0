# Buttons

Buttons follow Material 3's emphasis ladder, mapped to season tokens.

| Variant | Style | Use |
|---|---|---|
| **Filled** | Accent fill, surface-colored label | The main action; at most one per surface |
| **Outlined** | Surface fill, `--theme-outline` border, accent label | Secondary actions, "Add item" |
| **Text** | No fill, muted label | Cancel and low-emphasis actions |
| **Danger** | Text style in `--theme-danger`, with a border when standalone | Delete, remove |
| **Icon** | 44px target, `aria-label` required | Close, overflow |
| **FAB** | Mobile only, bottom-right, above the tab bar | Create on a list screen |
| **Brand-locked** | Native brand colors | Google sign-in |

## Size

| | Web | Mobile |
|---|---|---|
| Height | `h-10` (40px) | `h-12` (48px) in footers, otherwise `h-11` (44px) |
| Radius | `rounded-lg` | `rounded-lg` |
| Hero CTA | 52px, `rounded-xl` | 52px, `rounded-xl` |
| Label | `text-sm font-semibold` | `text-sm font-semibold` |

## States

| State | Treatment |
|---|---|
| Hover (web) | `hover:opacity-90` |
| Pressed | `active:opacity-70` |
| Focus | `focus-visible:ring-2` in accent |
| Disabled | `opacity-40 cursor-not-allowed` |
| Busy | Disabled, with a present-tense label such as "Saving…" |

## Placement

**Action order is the same everywhere:** destructive at the start, then Cancel, then the
primary at the far end.

```
[ Delete ]                         [ Cancel ] [ Save ]
```

**Buttons are anchored.** Form actions live in `FormFooter`, dialog actions in the dialog's
footer, and list-screen create actions in a FAB (mobile) or the page header (web). A form
action never sits mid-content or scrolls away. See [forms](forms.md).

## Decisions

- **Filled accent is the primary.** The old rule called a surface-colored button with an
  accent label "primary". On a footer of the same color it barely reads as a button. Accent
  fill is already common in the code (31 inline accent fills, not all of them buttons,
  against 7 of the neutral style), and its label passes at 8.52, 5.27 and 9.90.
- **Trailing primary replaces Save-then-Cancel.** Material 3 puts the confirming action at
  the far end, which also lands under a right thumb. `EventScheduleEditor.tsx:281` is the outlier.
- **Mobile footer buttons are 48px,** matching the M3 target for a repeated, important tap.
- **Disabled is 40% everywhere.** The code has 40, 45 and 50.
- **Save is not disabled for validation.** See [forms](forms.md).

## Remaining debt

All buttons use the shared `Button` / `buttonClass`, in the documented order. What is left:

- `MembersPage.tsx` desktop grid action buttons (32px) and the `MeetingHoursEditor.tsx` / `AttendancePage.tsx` calendar day cells (38px) keep their dense sizes, because the grid and calendar geometry is fixed. They are `default`-size violations on purpose; revisit with the grid.
- `TasksPageDesktop.tsx` `TaskRow` keeps its hand-built chips and icon buttons (inline styles at 17/24/28px). They are part of the row's fixed geometry.
