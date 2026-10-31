# Loading

The app currently has one loading pattern: the text "Loading…". It has no spinners or
skeletons. This system keeps that simplicity and adds only what's missing. Behavior is the
same on web and mobile.

| Wait | Pattern |
|---|---|
| Under 300ms | Show nothing |
| Section or list | Skeleton matching the layout, `animate-pulse` |
| Whole page | Skeleton of the page, inside the shell |
| One short value of unknown shape | "Loading…" in muted `body` |
| Button action | Disabled, present-tense label |
| App start | Existing splash, until `markReady` |
| Background refresh | Keep current content; no indicator |
| Long job | Linear progress bar under the header, with a label |

## Rules

- **Shell first.** Keep the header, tabs and FormFooter visible while content loads.
- **Reserve the space.** Skeletons match the final size so content doesn't jump.
- **Delay by 300ms** before showing a loading indicator, so fast responses don't flicker.
- **Button width doesn't change** between "Save" and "Saving…"; set a `min-width`.
- **Copy is a fixed set:** "Saving…", "Adding…", "Deleting…", "Signing in…".
- **Announce:** set `aria-busy` on the region, with a polite status for waits over 1 second.
- **Reduced motion:** skeletons stay static.

## Decisions

- **Skeletons rather than spinners for content.** They preview the structure and avoid layout
  shift, which matters most on the data-heavy lists here.
- **No spinner in buttons.** The label already communicates progress, is read by screen
  readers, and is what the code already does.
- **Text "Loading…" remains allowed** for small inline values, where a skeleton would be more
  elaborate than the wait.
- **Optimistic updates are not a default.** Changes here affect shared team data, so a failed
  write that appeared to work is worse than a brief wait.

## Migration

- Add one `Skeleton` component.
- Start with the highest-traffic lists: `TasksPageDesktop.tsx:269`, `TasksPageMobile.tsx:308`, `DashboardPage.tsx:165`, `EventTasksPage.tsx:146`.
- Replace the empty title during load at `EventShell.tsx:112` with a skeleton line.
