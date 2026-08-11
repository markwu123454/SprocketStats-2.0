# Sprocket Design System (SDS)

A prescriptive system for building SprocketStats UI — not a record of what exists, but
the rules for what to build next. Where current code deviates from a rule here, the
rule wins for new work; existing screens migrate opportunistically (tracked in §8).

The system is doc-only for now: no new token files or component library. Every token
below maps onto a real CSS custom property or Tailwind class already in the codebase —
this doc adds the *names* and *rules*, not new machinery. If the system later graduates
to code (a token file, extracted components), that implementation must match this
document exactly rather than the other way around.

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
6. **No new one-off values.** Every color, size, radius, duration, or easing used in a
   new component must be one of the named tokens below. If none fits, that's a signal
   to propose a new token (§8), not to inline a value.

---

## 2. Foundations

### 2.1 Color

Colors are consumed exclusively through **semantic roles**, never raw hex/Tailwind
color classes. Each role resolves differently per season theme (`theme-2025`,
`theme-2026`, `theme-2027`) via the CSS custom properties already defined in
`index.css`; a new theme only has to define these properties to be visually complete.

| Role | Token (CSS var / utility class) | Use for |
|---|---|---|
| Surface | `--theme-bg` / `.theme-bg` | Solid panel/header/sidebar/menu backgrounds |
| Surface image | `--theme-bg-page` / `.theme-bg-page` | Full-bleed season hero background |
| Accent fill | `--theme-button-bg` / `.theme-button-bg` | Primary button + hero panel fill |
| Accent fill (hover) | `--theme-button-hover` / `.theme-button-hover` | Hover/active state of the above |
| Border | `--theme-border` / `.theme-border` | All borders, dividers, rules |
| Text — default | `--theme-text` / `.theme-text` | Body copy |
| Text — emphasis | `--theme-h1-color` / `.theme-h1-color` | Headings, brand wordmark, high-emphasis labels |
| Text — muted | `--theme-subtext-color` / `.theme-subtext-color` | Captions, helper text, timestamps |
| Text — accent | `--theme-text-contrast` / `.theme-text-contrast` | Active nav state, links, badges, focus emphasis |
| Scrollbar | `--scrollbar-thumb` / `.theme-scrollbar` | Any scrollable container |

**Rule:** if a component needs a tinted version of a role (e.g. a soft highlight
behind an active row), derive it with `color-mix(in oklch, var(--theme-x) N%, transparent)`
rather than a fixed-opacity wrapper or a new rgba literal. This is what makes a tint
correct across all three seasons without per-theme overrides.

#### Danger role (semantic, season-invariant)

Error/destructive states use a fixed role, independent of season, because a season
palette should never make an error look like anything other than an error:

- `--theme-danger`: `#dc2626`
- `--theme-danger-border`: `color-mix(in oklch, #dc2626 40%, transparent)`
- `--theme-danger-bg`: `color-mix(in oklch, #dc2626 10%, transparent)`

Any error notice, inline validation message, or destructive-action affordance uses
these three, always together (text = `--theme-danger`, border = `-border`, fill =
`-bg`). Never use a bare Tailwind red (`text-red-500`, etc.) — that's a known debt
item, see §8.

#### Brand-locked exceptions

A small, closed set of colors don't theme, because they're not SDS's to change:

- Google button: fixed white surface / `#1f1f1f` text / official G mark colors
  (required by Google's brand terms).
- Any other third-party auth or brand mark added later follows the same rule:
  render it in its native colors, never re-skin it into the season palette.

### 2.2 Typography

No custom webfont — system font stack (`Segoe UI`, `system-ui`, sans-serif) via
`font-sans`. Type is a named scale, not ad-hoc sizes:

| Token | Size / weight / tracking | Use for |
|---|---|---|
| `display` | `text-[32px] font-semibold tracking-[-0.01em]` | Auth/onboarding hero headings only (Sign in, Welcome aboard) |
| `h1` | `text-2xl font-bold` (24px) | Interior app screen titles (Dashboard, Settings) |
| `h2` | `text-xs font-semibold uppercase tracking-widest` on `theme-subtext-color` | Section group labels within a screen |
| `title` | `text-lg font-semibold` | Card/row primary label (user name, stat name) |
| `body` | `text-sm` (14px) | Form labels, descriptions, default UI copy |
| `caption` | `text-[12px]`, often `opacity-70` over `theme-subtext-color` | Legal text, footnotes, sponsor lines |
| `micro` | `text-[11px]` | Smallest fine print (compact legal line) |
| `badge` | `text-[10–11px] font-mono uppercase tracking-[0.14em]–[0.18em]` | Season phase badge, time badge, mono accents |

**Rule:** `display` is reserved for the auth/onboarding hero surfaces — it must never
appear on an interior app screen. `h1` is reserved for interior screens — it must
never appear on the hero surfaces. This resolves what used to be two competing "H1"
conventions: they're two different named tokens with disjoint contexts, not
inconsistency.

### 2.3 Spacing

Base unit is Tailwind's default 4px scale. Use Tailwind step utilities (`p-5`, `gap-2`,
`mt-1.5`, …) for everything inside the app shell and interior screens — do not invent
arbitrary pixel gaps there.

| Alias | Tailwind step | px |
|---|---|---|
| `space-xs` | `1` | 4 |
| `space-sm` | `2` | 8 |
| `space-md` | `3` | 12 |
| `space-lg` | `5` | 20 |
| `space-xl` | `8` | 32 |

**Exception:** the auth hero compositions (`HeroContent`, `OnboardingHero`,
`LoginPageDesktop`/`Mobile`) are pixel-tuned marketing-style layouts and may use
arbitrary values (`p-11`, `gap-[18px]`, sheet-height constants) to hit exact visual
targets. This exception is scoped to those hero/sheet layouts only — a settings page
or a card grid always uses the step scale.

### 2.4 Shape

Three radii, each tied to a role, not a size preference:

| Token | Class | px | Use for |
|---|---|---|---|
| `radius-control` | `rounded-lg` | 8 | Inputs, small/secondary buttons, menu option rows |
| `radius-surface` | `rounded-xl` | 12 | Primary CTAs, cards, dropdown/menu/modal containers |
| `radius-pill` | `rounded-full` | — | Avatars, badges/pills, toggle track & thumb |

Never use a radius outside this set (no `rounded-md`, `rounded-2xl`, custom radius).

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

| Token | Value | Use for |
|---|---|---|
| `duration-fast` | ~150ms (Tailwind default) | Hover/opacity/icon micro-interactions |
| `duration-base` | 200ms | Toggle thumb slide, small state changes |
| `duration-moderate` | 220ms | Sidebar collapse/expand |
| `duration-slow` | 340–380ms | Reveal/hide of secondary content, sheet drag settle |
| `ease-standard` | `cubic-bezier(0.4, 0, 0.2, 1)` | Structural resize (sidebar width) |
| `ease-sheet` | `cubic-bezier(0.32, 0.72, 0, 1)` | Sheet/drawer settle (mobile bottom sheet) |

**Rule:** micro-interactions (hover, active-icon rotation) don't need an explicit
easing — Tailwind's default `transition-opacity`/`transition-transform` is enough.
Anything that moves a panel or resizes a container gets one of the two named curves
above, chosen by whether it's a rigid resize (`ease-standard`) or a soft settle
(`ease-sheet`). Never introduce a third curve without adding it here first.

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

- **Anatomy:** container (radius-surface, 52px tall for primary CTAs) + optional
  leading/trailing icon (`icon-sm`) + label (`body`, `font-semibold`).
- **Variants:**
  - *Primary* — `theme-bg` fill, `theme-border`, `theme-text-contrast` label. The only
    filled button in the system.
  - *Icon-only* — no fill/border, icon at `opacity-50 hover:opacity-100`, no visible
    hit-box styling.
  - *Brand-locked* (Google, and future third-party auth) — exempt from all of the
    above, rendered per §2.1's brand-locked exceptions.
- **States:** default / hover (`theme-button-hover` fill or opacity bump for icon
  buttons) / disabled (`opacity-40`, `cursor-not-allowed`, never a separate disabled
  color) / loading (label swaps to a present-tense string, e.g. "Signing in…", icon
  stays put or is suppressed).
- **Rules:** primary buttons are `radius-surface` at 52px; anything smaller (inline,
  secondary actions) is `radius-control`. Never introduce a second filled-button color
  — accent emphasis comes from `theme-text-contrast` label color on a neutral fill,
  not from a saturated background.

### 3.2 Text input

- **Anatomy:** `radius-control` container, `theme-border`, `px-3 py-2.5`, `body` text.
- **States:** default / focus (`focus:ring-2`, ring color = accent) / filled
  (`theme-text`) / empty (placeholder = `theme-subtext-color`) / error (border swaps
  to `--theme-danger-border`, helper text below in `--theme-danger`).
- **Rules:** always paired with a `body`-weight `font-semibold` label above it, never
  a floating/inline label.

### 3.3 Select (custom listbox)

- **Anatomy:** trigger button (same shape as text input) + `icon-sm` chevron that
  rotates 180° on open + Level-1 floating panel (`radius-surface`, `role="listbox"`)
  with option rows (`radius-control` hover state, `Check` icon on the selected row).
- **Rules:** this is the only select pattern — never use a native `<select>` or a new
  one-off dropdown. The panel flips above the trigger (`dropUp`) when there isn't room
  below; that flip logic is required for any new instance, not optional polish.

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
  related cards under an `h2`-token section label.

### 3.7 Notice / alert (danger only today)

- **Anatomy:** `radius-control` container, `--theme-danger-border` border,
  `--theme-danger-bg` fill, `--theme-danger` text, `caption`-scale copy.
- **Rules:** reserved for error/destructive messaging. A success/info variant doesn't
  exist yet — don't invent one ad hoc; propose it via §8 first (it needs its own
  season-invariant-vs-themed decision, same as danger did).

### 3.8 Badge / pill

- **Anatomy:** `radius-pill`, `border theme-border`, `theme-bg`, `badge`-scale text,
  optional `backdrop-blur-sm`.
- **Use for:** season phase tag, time-context labels. Not used as a generic tag/chip
  component elsewhere yet — if one is needed, this is the shape to reuse.

### 3.9 Navigation item (sidebar row / tab-bar item)

- **Anatomy:** icon (`icon-md` sidebar / `icon-lg` tab bar) + optional label
  (`body`, `font-medium`).
- **States:** inactive = `theme-text opacity-55` (sidebar) or `opacity-45` (tab bar);
  active = `theme-text-contrast` at full opacity, sidebar additionally gets a
  `color-mix` background pill (§2.1) behind the row. Tab-bar active state also bumps
  icon `strokeWidth` from 1.8 to 2.2 — no background pill on mobile (no room).
- **Rules:** state is communicated by opacity + accent color per Principle 3 — never
  swap the icon itself or add a bright fill as the *only* signal.

### 3.10 Menu / popover

- **Anatomy:** Level-1 floating panel, `radius-surface`, header block (avatar + name +
  email + role, when it's a user menu) separated by `theme-border`, then action rows
  matching the icon-button pattern.
- **Rules:** dismiss on outside click (required — implemented via a ref + document
  listener pattern, reuse it rather than a new click-outside hook).

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

- **Focus:** every interactive control gets a visible `focus:ring-2` — never remove
  focus outlines without replacing them.
- **Touch targets:** minimum 44px in the tappable dimension; primary CTAs are 52px.
  Icon-only buttons get at least a 36px hit box even if the icon itself is smaller.
- **Custom widgets get real ARIA:** the select pattern (§3.3) requires
  `role="listbox"`/`role="option"`/`aria-selected`/`aria-expanded`/`aria-haspopup` —
  any new custom interactive control (not a native form element) needs the equivalent
  real ARIA roles/states, not just visual styling.
- **Color is never the only signal.** Nav active state, form errors, and toggle state
  all pair opacity/position/icon changes with color, per Principle 3 — don't add a
  new state that's color-only.
- **Motion:** none of the current transitions are purely decorative distance/duration
  outliers, but there's no `prefers-reduced-motion` handling yet — treat that as an
  open item (§8), not a green light to add more motion without it.

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

- `OnboardingForm`'s inline validation message uses Tailwind `text-red-500` instead
  of the `--theme-danger` role (§2.1). Migrate to match `LoginErrorNotice`.
- No `prefers-reduced-motion` handling anywhere motion tokens (§2.6) are used.
- No success/info notice variant exists yet (§3.7) — don't add one ad hoc if a need
  comes up; decide its season-invariance question deliberately, the way danger's was
  decided, and add it here first.
