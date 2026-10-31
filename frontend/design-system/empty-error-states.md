# Empty and error states

Every data view handles four states: loading, empty, error and content. Every message says
what happened and what the user can do. Layout is the same on web and mobile unless noted.

## Empty

| Type | Pattern | Example |
|---|---|---|
| Nothing yet | Muted line, plus an action if the user can create | "No tasks linked to this event yet." + **Add task** |
| Inside a card or list | One `body` muted line, `py-2` | "No hours logged yet." |
| No results | "No matches", with a clear-filters action where filters apply | Dropdown search, task filters |
| Whole screen | Centered icon, title, one sentence, one action | First use of a page |
| No permission | Say who can grant it | "Ask a captain or mentor to approve you." |

## Error

| Type | Pattern | Placement |
|---|---|---|
| Field | `caption` in `--theme-danger` with an icon | Below the field |
| Form save failed | Danger notice, input kept | Directly above FormFooter |
| Section failed to load | Danger notice with **Try again** | In place of the section |
| Page failed to load | Whole-screen pattern with **Try again** | Page body |
| Not found | Icon, title, sentence, way back | `NotFoundPage` |
| Action failed in a list | Snackbar with **Retry** | Above the tab bar on mobile, bottom start on web |
| Offline or server down | Persistent banner under the header | Page top |

Danger notice: `rounded-lg border`, `--theme-danger` text and border,
`color-mix(in oklch, var(--theme-danger) 10%, transparent)` fill, `AlertCircle` icon, `role="alert"`.

## Copy

- Use "Couldn't save the packing list. Try again."; the event pages already do this.
- Don't use "Failed to…", "Something went wrong" or raw `err.message`.
- Show server detail only when it's written for people, as `RosterPage.tsx:245` does for 4xx.

## Decisions

- **Errors offer a retry button rather than "Refresh to try again".** A refresh throws away
  state, and an installed PWA has no visible refresh button.
- **Save errors sit above the footer** so they appear next to the button just pressed. A
  top-of-form error may be scrolled out of view on a phone.
- **No persistent success notice is added.** Snackbars cover confirmations, and nothing in the
  app needs a success message that stays.
- **Icons accompany all error color,** because color alone fails WCAG 1.4.1.

## Migration

- Standardize copy on "Couldn't…" (`AttendancePage.tsx:158`, `SettingPage.tsx:88`, `MeetingHoursEditor.tsx:167`, `NotificationDetailPage.tsx:127`, and the Tasks pages).
- Stop showing `err.message` for network failures (`TasksPageMobile.tsx:829`).
- Add retry: `EventTasksPage.tsx:144`.
- Extract `EmptyState` and `Notice`, replacing `EmptyCard` (`EventTasksPage.tsx:253`) and `PageState` (`CompPage.tsx:456`).
- Add a shared Snackbar. `UpdatePrompt.tsx:36` is the position reference.
