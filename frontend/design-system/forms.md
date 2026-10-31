# Forms

## FormFooter: one footer for every form

Every form with a Save action uses the same footer, on web and mobile, whether in a page,
a sheet or a dialog.

```
┌ form scroll area ───────────────────────┐
│ fields scroll here                      │
├─────────────────────────────────────────┤ sticky bottom-0, border-t, theme-bg
│ [Delete]              [Cancel]  [Save]  │
└─────────────────────────────────────────┘
```

```jsx
<div className="sticky bottom-0 z-10 flex items-center gap-2 border-t theme-border theme-bg px-4 md:px-6 py-3">
  {onDelete && <DangerButton className="mr-auto">Delete</DangerButton>}
  <TextButton className="ml-auto">Cancel</TextButton>
  <FilledButton>Save</FilledButton>
</div>
```

| Rule | Web | Mobile |
|---|---|---|
| Position | Sticks to the bottom of the scroller | Same, above the tab bar and keyboard |
| Button height | 40px | 48px |
| Primary width | Fits its label | Fits its label, with `flex-1` when there is no Delete |
| Order | Delete, Cancel, Save | Delete, Cancel, Save |
| Safe area | None | Added when the footer is the lowest bar |

### Rules

1. **Save is always visible.** The footer never scrolls off, never unmounts and never appears only after an edit.
2. **Short forms use it too.** With no overflow, `sticky` simply rests after the last field, so one component handles every length.
3. **Pristine Save is disabled but still visible.** Enable it on the first edit. A create form that is valid with its defaults starts enabled.
4. **Invalid Save stays enabled.** Pressing it shows every error and moves focus to the first invalid field.
5. **While saving,** disable Save and Cancel and label the button "Saving…".
6. **Save failure** keeps the user's input and shows a notice directly above the footer.
7. **Unsaved changes:** a form is dirty when its values differ from the values it opened with. Leaving a
   dirty form by any route asks "Discard changes?" in an alert dialog (`confirmDialog`, **Discard** is the
   danger action): dismissing its sheet or dialog (scrim, Esc, close button, handle, drag), its **Cancel**
   or **Reset**, following an in-app link, and closing the tab. Declining keeps the form as it is.
   `useDiscardGuard(dirty)` from `lib/useDiscardGuard.ts` does this: it returns `confirmDiscard()` for
   Cancel (run the cancel handler only on `true`), arms `beforeunload`, holds back in-app link clicks
   (the app uses `BrowserRouter`, which has no `useBlocker`), and tells an enclosing `Sheet` it is dirty.
   Prompts are shared, so nested forms never double-prompt. After a save the form closes or its
   snapshot catches up, so it never prompts. Browser Back is not guarded (see debt).

### Where the footer is not used

| Case | Pattern | Why |
|---|---|---|
| Toggle or single-choice setting | Saves immediately | Material 3 treats switches as immediate; a Save step adds a tap for nothing |
| One inline field, like the Settings name | Save and Cancel beside the field | Both stay on screen with the field, and a bar would outweigh the edit |

Staged list edits, like Members, do use the footer, scoped to the list container.

## Fields

| Element | Spec |
|---|---|
| Label | `label` above the input; no floating labels |
| Input | `rounded-lg border px-3 py-2.5`, `input` type token, min 44px, `--theme-outline` border |
| Helper | `caption` in muted, below the input, linked by `aria-describedby` |
| Error | `caption` in `--theme-danger` with an icon, `aria-invalid`, replacing the helper |
| Required | Mark optional fields "(optional)" rather than starring required ones |
| Select | `Dropdown`; anchored menu on web, drag sheet on mobile |
| Boolean setting | Toggle |
| Item in a list | `Checkbox` with a 44px target |
| Time | `TimeWheel` (6:00 AM to 11:55 PM only) |
| Short choice set | Segmented buttons, 2 to 4 options |

Validate a field on blur and on Save, never on each keystroke. Clear an error as soon as
the input becomes valid.

## Decisions

- **A sticky footer rather than Save in the top bar.** Material 3 offers both for full-screen
  forms, but the footer sits in thumb reach and is the only placement that works unchanged
  in pages, sheets and dialogs. `EventScheduleEditor.tsx:280` already proves the pattern.
- **Always rendered rather than shown when dirty.** The Members mobile bar appears only after
  an edit (`MembersPage.tsx:578`), which shifts the layout under the user's thumb.
- **Invalid Save stays enabled.** A dead button can't explain itself; pressing it can.
  `NotificationDetailPage.tsx:558` currently disables it without saying why.
- **Pristine Save is disabled** because there is nothing to save, and a success message would
  falsely confirm a change.

## Remaining debt

All forms now use `FormFooter` (the migration table is complete). What is left needs new behaviour:

- The pristine rule: Save is enabled whenever the form is not busy, not only after a change. Dirtiness is tracked only to guard exits (`useDiscardGuard`), not to gate Save.
- "Discard changes?" does not cover browser Back / popstate (`BrowserRouter` cannot cancel it reliably), programmatic `navigate()` calls, or switching to another row's editor in place (`MeetingHoursEditor` row Edit, `RosterPage` pencil, the Tags and Attendance forms, which save immediately or hold no edits).
- `NotificationDetailPage.tsx`: an invalid form keeps Save enabled and reports the error on press, instead of disabling Save or showing field errors first. Changing it alters validation behaviour.
- `OnboardingShared.tsx` `SimpleDropdown` is a separate hand-built select, not the shared `Dropdown`. It should move to `Dropdown` once that can render in the onboarding flow.
- `TasksPageDesktop.tsx` and `TasksPageMobile.tsx` still duplicate content (note thread, task form fields, row pieces). Principle 5 wants a `TasksShared.tsx`; extracting it moves handlers and is a refactor, not a restyle.
