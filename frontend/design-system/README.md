# SprocketStats design systems

Eleven small systems, one per concern. Each covers web (`md` and up, 768px) and mobile
(below `md`), records what the code does today, sets the rule for new work, and justifies
every decision. `frontend/DESIGN_SYSTEM.md` remains the home for principles, shape,
elevation, icons, layout and voice.

| System | The rule that matters most |
|---|---|
| [Color](color.md) | Semantic roles only; every pair must pass in all three seasons |
| [Typography](typography.md) | Named scale; inputs are 16px on mobile |
| [Spacing](spacing.md) | 4px steps; 16px mobile and 24px web gutters |
| [Buttons](buttons.md) | One action order and one primary per surface |
| [Forms](forms.md) | One `FormFooter`, always visible, on every form and breakpoint |
| [Navigation](navigation.md) | Tab bar on mobile, sidebar on web; mobile menus are drag sheets |
| [Modals](modals.md) | Mobile: drag sheet for choices and edits, dialog for one decision |
| [Empty and error states](empty-error-states.md) | Say what happened and what to do next |
| [Loading](loading.md) | Keep the layout stable; label button progress |
| [Motion](motion.md) | Enter slower than exit; honor reduced motion |
| [Accessibility](accessibility.md) | WCAG 2.2 AA, with Material 3 targets on critical controls |

Material 3 is the reference for behavior. It does not replace the season palettes or the
border-first look: we borrow its component behavior, not its tonal color system or its
elevation model.

**Status:** these are the target rules. The app has not been migrated. Each file ends
with its migration list, and those lists are the work remaining.
