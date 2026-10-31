# Sprocket Design System (SDS)

A prescriptive system for building SprocketStats UI — not a record of what exists, but
the rules for what to build next. Where current code deviates from a rule here, the
rule wins for new work; existing screens migrate opportunistically (tracked in §8).

Color, typography, spacing, buttons, forms, navigation, modals, empty and error states,
loading, motion and accessibility each have their own system in
[`design-system/`](design-system/README.md). This doc holds what's left: principles,
shape, elevation, icons, smaller components, layout, voice and contribution rules. If
the system later graduates to code (extracted components), that implementation must
match these documents rather than the other way around.

---

## 1. Principles

1. **Season is the theme, not a mode.** SDS has no light/dark toggle — it has three
   season palettes (§2.1). Every rule here must hold across all three simultaneously.
   If a design only works in one season, it's wrong.
2. **Border over shadow.** Surfaces are separated by a 1px `theme-border`, not
   elevation shadows. Shadows are reserved for things that float above content
   (menus, sheets) — see §2.5.
3. **State is opacity, not color, for navigation.** Active/inactive in nav and tabs is
   communicated by opacity + the accent token, never by swapping the base color or
   adding a background fill as the primary signal.
4. **One layout per breakpoint fork.** `md` is the only chrome-level breakpoint.
   Content within a screen may add its own responsive behavior, but the shell
   (header/sidebar/tab-bar) never grows a second fork.
5. **Content lives once.** Where a surface has both a desktop and mobile layout, the
   content (copy, fields, validation) is a shared component imported by both; layout
   files own positioning and animation only. See §7.1.
6. **Content never sits directly on the season background.** Only a screen's `h1`, its
   subtitle and its page tabs may. Everything else (labels, fields, helper text, empty and
   error states, group headings) goes on a card surface: `rounded-xl border theme-border theme-bg`
   (§3.6). A group heading is the first row inside the card it labels (§3.6), never a bubble of its own. The artwork is busy,
   so unsurfaced text fights it.
7. **No new one-off values.** Every color, size, radius, duration, or easing used in a
   new component must be one of the named tokens below. If none fits, that's a signal
   to propose a new token (§8), not to inline a value.

---

## 2. Foundations

### 2.1 Color

See [design-system/color.md](design-system/color.md).

### 2.2 Typography

See [design-system/typography.md](design-system/typography.md).

### 2.3 Spacing

See [design-system/spacing.md](design-system/spacing.md).

### 2.4 Shape

Four radii, each tied to a role, not a size preference:

| Token | Class | px | Use for |
|---|---|---|---|
| `radius-control` | `rounded-lg` | 8 | Inputs, small/secondary buttons, menu option rows |
| `radius-surface` | `rounded-xl` | 12 | Hero CTAs, cards, anchored menus |
| `radius-sheet` | `rounded-2xl` | 16 | Sheets (top corners only) and dialogs |
| `radius-pill` | `rounded-full` | — | Avatars, badges/pills, toggle track & thumb |

Never use a radius outside this set (no `rounded-md`, `rounded-3xl`, custom radius). The one exception is the `Checkbox` box, at `rounded` (4px).

### 2.5 Elevation

Two levels only:

- **Level 0 — flat (default).** In-flow surfaces (cards, panels, the app shell itself)
  use a `theme-border` and nothing else. No shadow.
- **Level 1 — floating.** Anything that overlays other content (dropdown menus,
  the user-menu popover, modals, the mobile bottom sheet) gets `shadow-lg` *plus* a
  border. If it floats over the season background image rather than a flat surface,
  strengthen it with an explicit shadow for contrast:
  `box-shadow: 0 12px 32px -10px rgba(0,0,0,.45)`.

There is no Level 2+. If something feels like it needs more elevation than that,
it's probably a modal and should dim the surface behind it instead of stacking shadow.

### 2.6 Motion

See [design-system/motion.md](design-system/motion.md).

### 2.7 Iconography

`lucide-react` exclusively. Four sizes, chosen by role, not by eye:

| Token | px | Use for |
|---|---|---|
| `icon-xs` | 14–15 | Inline chevrons, disclosure carets |
| `icon-sm` | 16 | Menu row icons, form field icons |
| `icon-md` | 18–19 | Sidebar nav icons |
| `icon-lg` | 21 | Mobile bottom-tab icons |

---

## 3. Components

Each component is specified as **anatomy → variants → states → rules**. When you build
a new component, write its spec in this same shape before merging it, and add it to
this section.

### 3.1 Button

See [design-system/buttons.md](design-system/buttons.md).

### 3.2 Text input

See [design-system/forms.md](design-system/forms.md).

### 3.3 Select (custom listbox)

See [design-system/forms.md](design-system/forms.md) and [navigation](design-system/navigation.md). `Dropdown` is the only select: an anchored menu that flips upward on web, and a drag sheet on mobile.

### 3.4 Toggle switch

- **Anatomy:** track (`w-11 h-6 radius-pill`) + thumb (`w-5 h-5 radius-pill`,
  `bg-white`, always on a themed track so white is safe).
- **States:** on/off via track fill + thumb `translate-x`, both animated at
  `duration-base`. Disabled: `opacity-40` on the whole control.
- **Rules:** this is the only boolean-control pattern. Don't use a checkbox styled as
  a switch, or a segmented on/off pair, for a true boolean setting.

### 3.5 Avatar

- **Anatomy:** `radius-pill` container, either the user's image (`object-cover`) or,
  when absent, an initials monogram on `theme-button-bg` fill / `theme-text-contrast`
  text.
- **Rules:** always the shared `Avatar` component — never hand-roll an `<img>` with
  manual fallback logic. Fallback is required, not optional, since the source image
  field is allowed to be absent.

### 3.6 Card / panel

- **Anatomy:** `radius-surface`, `theme-border`, `p-5`, `flex flex-col gap-3`; may add
  `backdrop-blur-sm` when sitting directly over the season background image.
- **Rules:** Level 0 elevation only (§2.5) — a card never gets a drop shadow. Group
  related rows under an `h2`-token section label that is the card's first row (muted, no
  border or fill of its own); a stack of separate cards becomes one card with dividers between rows. A form page is one card: fields with
  `gap-4`, an internal `border-t theme-border` between groups, `p-5`, and the sticky
  `FormFooter` as the card's last child (`-mx-5 -mb-5 rounded-b-xl`, no `overflow-hidden`).
  Principle 6 applies: nothing but the `h1`, subtitle and tabs sits bare on the background.

### 3.7 Notice / alert (danger only today)

See [design-system/empty-error-states.md](design-system/empty-error-states.md).

### 3.8 Badge / pill

- **Anatomy:** `radius-pill`, `border theme-border`, `theme-bg`, `badge`-scale text,
  optional `backdrop-blur-sm`.
- **Use for:** season phase tag, time-context labels. Not used as a generic tag/chip
  component elsewhere yet — if one is needed, this is the shape to reuse.

### 3.9 Navigation item (sidebar row / tab-bar item)

See [design-system/navigation.md](design-system/navigation.md).

### 3.10 Menu / popover

See [design-system/navigation.md](design-system/navigation.md) and [modals](design-system/modals.md).

### 3.11 Button (`components/ui/Button`, `buttonClass`)

- **Anatomy:** label and optional leading lucide icon, `gap-2`, `text-sm font-semibold`.
- **Variants:** `filled` (the one primary), `outlined`, `text`, `danger`, `dangerOutlined`, `icon` (44px square), `fab` (mobile only). Sizes: `default` (44px mobile, 40px web), `footer` (48px mobile, 40px web), `hero` (52px, `rounded-xl`, auth only).
- **States:** hover and pressed are opacity; disabled is `opacity-40 cursor-not-allowed`; focus is the `focusRing` accent ring, keyboard only.
- **Rules:** `type="button"` unless it submits. Use `buttonClass` for an `<a>` that looks like a button. One `filled` per surface, in the order Delete, Cancel, primary. Order and wording: [buttons.md](design-system/buttons.md).

### 3.12 FormFooter (`components/ui/FormFooter`)

- **Anatomy:** a sticky bar, `border-t theme-border theme-bg`, `px-4 md:px-6 py-3`, `z-10`, holding buttons (and optionally a status line).
- **Variants:** `safeArea` adds the bottom inset when it is the lowest bar on screen (mobile sheets). Inside a padded scroller or card, cancel the padding with negative margins and add `rounded-b-xl` when the parent is a bordered card.
- **States:** inherits its buttons' states. No states of its own.
- **Rules:** every form has one, at every width; never overflow-clip the card that holds it (it breaks `sticky`). Layout, order and wording: [forms.md](design-system/forms.md).

### 3.13 Sheet (`components/ui/Sheet`)

- **Anatomy:** scrim, panel (drag handle and title header, scrolling content, optional pinned `footer`), close button.
- **Variants:** `kind="form"` (a centred dialog from `md`) and `kind="menu"`. Below `md` both are drag sheets.
- **States:** enter and exit animation (200ms exit before `onClose`); dragging; closed. Reduced motion skips the animation.
- **Props:** `dirty?: boolean`. While dirty, every user dismissal (scrim, Esc, close button, handle, drag past the threshold) first asks `confirmDialog` "Discard changes?"; declining keeps the sheet open and a drag settles back with `ease-sheet`. A form inside a sheet can instead call `useDiscardGuard(dirty)` (`lib/useDiscardGuard.ts`), which registers with the nearest Sheet.
- **Rules:** z-50, focus is trapped and restored, Esc and scrim dismiss unless the caller guards `onClose`. A required notice must not be a Sheet. Details: [modals.md](design-system/modals.md).

### 3.14 Confirm dialog (`confirmDialog` from `lib/confirmDialog`)

- **Anatomy:** centred `radius-sheet` alert with a `title`, optional `body`, Cancel and a confirm button.
- **Variants:** `danger` styles the confirm button as destructive.
- **States:** focus starts on Cancel; resolves `false` on Cancel or Esc.
- **Rules:** replaces `window.confirm`; one decision per dialog; sits at z-60 above a sheet. See [modals.md](design-system/modals.md).

### 3.15 Notice (`components/ui/Notice`)

- **Anatomy:** danger-tinted `rounded-lg` box, alert icon, message.
- **Variants:** danger only.
- **States:** none; it is `role="alert"`.
- **Rules:** place a save failure directly above the `FormFooter`, a load failure where the content would be. Say what happened and what to do next. See [empty-error-states.md](design-system/empty-error-states.md).

### 3.16 EmptyState (`components/ui/EmptyState`)

- **Anatomy:** optional icon, `title`, one line of copy, optional single action.
- **Variants:** `inline` (one muted line in a card or list) and `screen` (centred first-use).
- **States:** none.
- **Rules:** one action at most; never a bare "No data". See [empty-error-states.md](design-system/empty-error-states.md).

### 3.17 Skeleton (`components/ui/Skeleton`)

- **Anatomy:** a pulsing `rounded-lg` block, `aria-hidden`.
- **Variants:** sized by the caller (`h-*`, `w-*`) to match the content it replaces.
- **States:** pulse; static under reduced motion.
- **Rules:** replaces a "Loading..." line under the same condition and keeps the layout stable. See [loading.md](design-system/loading.md).

### 3.18 Toggle (`components/ui/Toggle`)

The spec is §3.4. The component exposes `role="switch"`, `aria-checked`, a 44px hit area and `onChange(next)`; give it `aria-label` or `aria-labelledby`.

---

## 4. Layout patterns

### 4.1 Desktop/mobile split with shared content

Any surface that needs materially different layouts per breakpoint (not just
reflowing columns — an actually different composition, like auth's split-pane vs.
bottom-sheet) is built as:

- `*Router.tsx` — picks desktop vs. mobile.
- `*Desktop.tsx` / `*Mobile.tsx` — own layout, positioning, and animation *only*.
- `*Shared.tsx` — owns every string, field, and interactive control, imported by both.

This is required, not optional, whenever a surface forks by breakpoint. A single
`*Shared.tsx` import in both is what guarantees desktop and mobile can never say
different things or expose different fields.

### 4.2 App shell

There is exactly one authenticated chrome: fixed header + collapsible desktop sidebar
(`56px`/`196px`, `duration-moderate`/`ease-standard`, state in `localStorage`) + content
outlet, with a mobile bottom tab bar swapped in below `md` (per Principle 4, this is
the only chrome fork). New authenticated screens render inside this shell's outlet —
they never define their own header/nav.

### 4.3 Full-viewport surfaces

Any container that must exactly fill the viewport (auth pages, the app shell root)
uses `style={{ height: "var(--real-vh, 100dvh)" }}`, never a bare `h-screen`/`100vh`/
`100dvh` Tailwind utility — mobile browser chrome collapse makes those unreliable.

### 4.4 Settings-style grouped list

A screen made of labeled groups of related controls (`SettingPage`) uses: `h2`-token
group label, then a `radius-surface` bordered container with `overflow-hidden`,
rows separated by internal borders. This is the default pattern for any future
preferences/settings-shaped screen.

---

## 5. Accessibility

See [design-system/accessibility.md](design-system/accessibility.md).

---

## 6. Voice

- Headings are short, second person, and address the user directly ("Sign in",
  "Welcome aboard", "Let's get your profile set up").
- Error/status copy states the situation and, where possible, the fix ("Your account
  is awaiting approval. Ask a captain or mentor to approve you, then sign in again."),
  not a bare error code.
- No exclamation points except the one hero tagline ("Let's go Team Sprocket!") —
  keep functional UI copy calm.

---

## 7. Contribution rules

1. **Reuse before you invent.** Before adding a color, size, radius, duration, or
   component, check §2–§3 for something that already covers it.
2. **New token → this doc first.** If nothing fits, add the token here (with its
   value and rationale) in the same change that introduces its first use. A token
   that exists only in component code and not in this doc isn't part of the system.
3. **New component → spec it in §3.** Anatomy, variants, states, rules — written
   before or alongside the implementation, in the same format as the existing entries.
4. **Deviations are debt, not precedent.** If a change can't follow a rule here,
   that's a note in §8, not a silent exception — the next person shouldn't have to
   rediscover it by reading two components that disagree.

---

## 8. Known debt (rules this doc sets that current code doesn't yet follow)

Each system in [`design-system/`](design-system/README.md) ends with its own "Remaining debt" list. Add new debt there.

