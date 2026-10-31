# Accessibility

The target is WCAG 2.2 AA in all three seasons, on web and mobile.

## Requirements

| Area | Rule |
|---|---|
| Text contrast | 4.5:1, or 3:1 at 24px and above. See [color](color.md) |
| Control boundary | 3:1, using `--theme-outline` |
| Focus | Visible `focus-visible:ring-2` in accent on every control |
| Target size | 44px minimum; 48px for footer buttons, sheet rows and tabs |
| Zoom | Pinch zoom always allowed; layout works at 200% |
| Color alone | Never; pair it with an icon, text or shape |
| Motion | Honor reduced motion. See [motion](motion.md) |
| Dragging | Always has a single-pointer alternative |
| Keyboard | Everything operable; no traps except an open modal's focus cycle |
| Labels | Every input has a visible `<label>`; every icon button has `aria-label` |
| Errors | `aria-invalid`, `aria-describedby`, `role="alert"` on notices |
| Status | Save results and loading use a polite live region |
| Headings | One `h1` per screen, no skipped levels |
| Landmarks | `header`, labelled `nav`, `main` |

## Custom widgets

| Widget | Must have |
|---|---|
| `Dropdown` | `listbox`/`option`, `aria-expanded`, `aria-selected`, arrow keys |
| Sheet | `dialog`, `aria-modal`, focus trap, focus return, Esc; handle is a labelled button |
| Toggle | `<button role="switch" aria-checked>`, label |
| `Checkbox` | Native input, `mixed` state, 44px hit area |
| `TimeWheel` | `spinbutton` with `aria-valuetext`; arrow keys change the value |
| Tabs | `tablist`/`tab`/`tabpanel`, arrow keys |
| Sticky footer | `scroll-padding-bottom` so focused fields clear it |

## Decisions

- **Targets are 44px, rising to 48px on critical controls.** WCAG 2.5.8 AA needs only 24px, Apple
  suggests 44 and Material 3 suggests 48. The existing `min-h-11` pattern is 44, so a full move to
  48 would touch everything for little gain. Critical tap zones get the extra size.
- **The zoom lock is removed.** It stops iOS input zoom, and 16px mobile inputs solve that
  directly. Low-vision users need pinch zoom.
- **Sticky footers need scroll padding.** Without it, a keyboard user can tab into a field hidden
  behind the footer, failing WCAG 2.4.11. This is the one new risk the footer rule introduces.
- **Every season must pass,** because a user can't choose a different season to escape a failure
  unless they know to look for the setting.

## Testing

Before merging UI work: tab through it, test at 360px and at 200% zoom, check all three seasons,
run VoiceOver or TalkBack on sheets, and test with reduced motion on.

## Migration

Priority order:

1. `index.html:5`: remove `maximum-scale=1.0, user-scalable=no`, after 16px inputs land.
2. `Checkbox.tsx:22`: the hit area is 16px; extend the input to 44px.
3. `TimeWheel.tsx`: add keyboard support and `spinbutton` semantics; it has neither today.
4. `TasksPageMobile.tsx:1123`: the toggle has no `role="switch"`, `aria-checked` or label.
5. `TasksPageMobile.tsx:964`, `MembersPage.tsx:828`: 36px close buttons rise to 44px; `MembersPage.tsx:928` is smaller and has no `aria-label`.
6. Add focus trapping to all modals. None has it today.
7. Move control boundaries to `--theme-outline`.
