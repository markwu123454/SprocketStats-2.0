# Navigation

| Element | Web (`md` and up) | Mobile (below `md`) |
|---|---|---|
| Primary | Collapsible sidebar, 56 or 196px | Bottom tab bar |
| Header | Fixed top bar | Top bar, replaced by the event header inside an event |
| Account menu | Anchored menu | **More sheet** (the avatar and the More tab open the same one) |
| Pages outside the tab bar | Sidebar rows, Control Panel accordion | **More sheet** |
| Overflow and row menus | Anchored menu | **Drag sheet** |
| Select options | Anchored menu | **Drag sheet** |
| Sections in a screen | Tabs | Tabs, scrollable sideways |
| Going back | Back link | Back icon at the start of the top bar |

## The mobile menu rule: all drag

**Every mobile menu is a drag sheet.** See [modals](modals.md) for the sheet's spec.

Today the app has four patterns: a centered bubble in `Dropdown.tsx:272`, an anchored popover
in `AppShell.tsx:206`, a sheet with a handle that does not drag in `TasksPageMobile.tsx:948`,
and sheets with no handle in `MembersPage.tsx:816` and `EventEditSheet.tsx:32`.

### Why drag rather than bubble

- **Reach.** Options land at the bottom of the screen, where a thumb already is. A centered
  bubble or a popover under a top-right avatar needs a stretch.
- **Capacity.** A sheet holds a long, searchable list at full height.
- **Fit with forms.** Editing already happens in sheets, so one gesture works throughout.
- **Material 3.** It offers bottom sheets as the mobile alternative to menus.

The cost is real: `Dropdown`'s bubble tracks the keyboard with `--real-vh`, and its sheet must
keep that behavior for searchable lists.

### What stays anchored on mobile

These are not menus, so they don't become sheets:

- **Tooltips**. They hold no actions, and a sheet is too heavy for one sentence.
- **Input suggestions** such as `AreaInput`. They must stay attached to the field while typing.

## Menu rows

| | Web | Mobile |
|---|---|---|
| Container | `rounded-xl border shadow-lg`, `role="menu"` or `listbox` | Drag sheet |
| Row height | 40px | 48px |
| Selected | Check icon and accent text | Check icon and accent text |
| Destructive | `--theme-danger`, after a divider, last | Same |
| Dismiss | Outside click, Esc, choosing | Scrim, drag, close button, Esc, choosing |
| Submenus | Avoid | Never; open a new sheet step instead |

## Tab bar and sidebar

- The tab bar holds at most 5 destinations, Material 3's limit and today's maximum.
- Each tab's target fills its cell, at least 48px high.
- Active: accent color, heavier icon stroke and `aria-current="page"`. Inactive: `opacity-70`.
- The tab bar is `h-16` plus the safe area, in place of today's `h-20`/`h-24`.
- Sidebar rows add a tinted pill when active.
- The fifth slot is **More**, a button rather than a link. It opens the More sheet
  (`MoreSheet.tsx`) and shows as current on every page the sheet lists, and while it is open.

## The More sheet

One drag sheet holds everything the tab bar has no room for, in this order:

1. The account: avatar, name, email, role, and a Settings button.
2. **Pages**: the tabs not in the bar that this role can see (`moreTabs` in `navTabs.ts`).
3. **Manage**: the Control Panel sections this role can open (`visibleSections`), as 48px rows.
4. Sign out, after a divider.

Every destination is one tap from anywhere; there are no list-only pages in between, and
Control Panel pages have no back link. It takes the form height (up to 92dvh), not the menu
cap, so a captain's full list shows without scrolling.

## Decisions

- **Inactive tabs rise to `opacity-70`.** At today's 45% the 2026 season measures 2.55:1, and
  2025 and 2027 also miss 4.5. At 70% they measure 8.13, 5.03 and 7.20.
- **The tab bar shrinks to 64px.** It takes 80 to 96px today, and forms above it need that room
  for their footer. Material 3 uses 80px, but much of that goes to a pill indicator we don't have.
- **Web keeps anchored menus.** A pointer has no reach problem, and a bottom sheet on a wide
  screen feels disconnected from its trigger.
- **`md` stays the only chrome breakpoint.**
- **More is a sheet, not a page.** The old Other page led to a Control Panel page of cards,
  so reaching Members took three taps through two list pages, and its back arrow went to
  Control Panel rather than Other. Settings was also listed twice (Other and the account sheet).

## Remaining debt

The mobile `Dropdown` and account menu are sheets, the tab bar and inactive opacity match, and the sidebar flyout opens on keyboard focus. What is left:

- Tabs (`EventShell.tsx` links, the tab rows in `NotificationDetailPage.tsx` and `PushNotificationsPage.tsx`) have no arrow-key navigation (see accessibility.md).
- `EventShell.tsx` tab labels are 11px and scroll sideways on narrow phones rather than all fitting at 360px.
