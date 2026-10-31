# Modals

Choose by the job, then let the breakpoint choose the form.

| Job | Web | Mobile |
|---|---|---|
| Choose from a menu | Anchored menu | Drag sheet |
| Edit or create | Centered dialog | Drag sheet |
| Confirm one decision | Centered alert dialog | Centered alert dialog |
| Required notice | Centered dialog, not dismissible | Same |
| Passive result | Snackbar | Snackbar |

## Drag sheet (mobile)

```
╭───────────────────────╮  rounded-t-2xl, border-t, theme-bg
│        ━━━━━          │  handle: 32×4 visual, 48px tall hit area
│ Title            [×]  │  title token; 44px close button
├───────────────────────┤
│ scrolling content     │  overflow-y-auto, overscroll-contain
├───────────────────────┤
│ FormFooter (forms)    │  sticky, includes the safe area
╰───────────────────────╯
```

| Property | Spec |
|---|---|
| Height | Menus fit their content up to 60dvh. Forms and searchable lists use up to 92dvh |
| Scrim | `rgba(0,0,0,.5)`; tap dismisses |
| Drag zone | Handle and header only |
| Dismiss on release | Dragged past 25% of height, or flicked faster than 0.5px/ms |
| Otherwise | Settles back with `ease-sheet` |
| Without a gesture | Close button, scrim, Esc, or activating the handle |
| Keyboard | Height follows `--real-vh`; the footer stays above the keyboard |
| Dirty form | `dirty` prop (or a form calling `useDiscardGuard`): scrim, Esc, close button, handle and a drag past the threshold stop and ask "Discard changes?". Declining keeps the sheet open and a drag settles back with `ease-sheet`. One prompt at a time |
| Background | Scroll locked with `useScrollLock` |
| Focus | Trapped; moves to the sheet on open and back to the trigger on close |

## Dialog (web) and alert dialog (both)

| Property | Dialog | Alert dialog |
|---|---|---|
| Width | `max-w-lg` | `max-w-sm`, 16px screen margin |
| Radius | `rounded-2xl` | `rounded-2xl` |
| Height | Up to 92dvh with an inner scroll | Fits content |
| Content | Title, close button, body, FormFooter | Title, one sentence, actions |
| Scrim click | Dismisses unless dirty | Does nothing |
| Esc | Dismisses unless dirty | Cancels |
| Roles | `role="dialog"`, `aria-modal`, `aria-labelledby` | `role="alertdialog"` |

Alert copy names the action: "Delete this day's itinerary?" with **Cancel** and **Delete**,
never "Are you sure?" with OK.

## Layers

| z | Layer |
|---|---|
| 10 | Sticky headers and footers within a page |
| 30 | App chrome, FAB |
| 40 | Anchored menus, tooltips |
| 50 | Sheets and dialogs |
| 60 | Alert dialog over a sheet |
| 100 | Required notice gate |
| 110 | Snackbar, update prompt |

## Decisions

- **The content scrolls and only the header drags.** Dragging from content conflicts with form
  scrolling and `TimeWheel`, and an accidental dismissal could lose edits.
- **Dragging is never the only way out.** WCAG 2.5.7 requires a single-pointer alternative, so
  every sheet also has a close button.
- **Confirmations stay centered on mobile.** Material 3 reserves dialogs for interruptions, and a
  centered card signals "decide now" in a way a sheet does not. This doesn't break the all-drag
  rule, because a confirmation isn't a menu.
- **Sheets have one open height.** Multi-stop sheets add a state to discover, and these forms gain
  nothing from a half-open view. The login sheet keeps its peek stop as a hero composition.
- **A new `radius-sheet` token allows `rounded-2xl`.** The old doc banned it, but sheets and
  dialogs across the app use it. The 22px at `TasksPageMobile.tsx:957` comes onto this value.
- **One shared sheet.** Extract it from `EventEditSheet.tsx`, which already switches between sheet
  and dialog at `md`, and add the drag behavior.

## Remaining debt

`Sheet` and `ConfirmDialog` are adopted everywhere a modal existed, with roles, labelling, focus trapping and the z-index table. What is left:

- `OnboardingShared.tsx` `SimpleDropdown` is not a `Sheet`-backed menu on mobile (see forms.md).
