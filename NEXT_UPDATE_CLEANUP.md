# Next update: remove one-release compatibility code

Phones only update when the member taps Reload, so two things are kept for **one release** to keep older app builds working. **In the next update, delete both**, then delete this file.

| Tag | What it keeps working |
| --- | --- |
| `LEGACY-16-DIGIT` | Old 16-digit member codes get an "Update app" message instead of being ignored |
| `LEGACY-OFFLINE-CODE` | `/auth/me` sends a blank `offline_code` so old dashboards don't crash |

Search both repos for each tag:

```
git grep -n "LEGACY-16-DIGIT"
git grep -n "LEGACY-OFFLINE-CODE"
```

# 1. Old 16-digit member codes (`LEGACY-16-DIGIT`)

Member codes went from 16 digits (14x14 Data Matrix) to 24 digits (16x16), with a 2-digit header for format version and type (see the docstring at the top of `backend/core/member_codes.py`). This was a hard cutover. Phones only update when the member taps Reload, so for **one release** the old 16-digit codes are still recognized, only to tell the member to update the app.

**In the next update, delete all of it.** After that, an old code is just "some other Data Matrix", which the scanners ignore.

## SprocketStats-2.0

- `backend/core/member_codes.py`: `_LEGACY_RE` and `is_legacy()`.
- `backend/endpoints/kiosk.py` `_member_from_code`: the `is_legacy` branch that returns 426 "Update the SprocketStats app on your phone, then try again."
- `backend/tests/test_member_codes.py`: `test_legacy_codes_are_recognized_but_not_parsed`.
- `backend/tests/test_kiosk_scan.py`: `test_old_app_code_asks_member_to_update` and `test_old_app_code_warns_at_authorize_too`.
- `frontend/src/lib/codeReader.ts`: `LEGACY_CODE_RE` and its uses in `memberCodeOf` and `codeNumberOf`.

## SprocketStats-Attendance (kiosk)

- `src/lib/useCodeScanner.ts`: `LEGACY_CODE` and the `?? LEGACY_CODE.exec(...)` fallback.
- `src/pages/KioskPage.tsx` and `src/pages/SetupPage.tsx`: the `err.status === 426` "Update app" label.
- `README.md`: the paragraph about 16-digit codes from older app builds.

# 2. Blank `offline_code` in `/auth/me` (`LEGACY-OFFLINE-CODE`)

Offline codes were removed: nothing reads them, the kiosk endpoints that took them are gone, and migration 17 drops `users.offline_code`. App builds from before that removal read `user.offline_code.length` on the dashboard, and the oldest have no error boundary, so a missing field blanks the whole app. For **one release** `/auth/me` sends `"offline_code": ""`, which old builds show as an empty code.

**In the next update, delete it.** Current builds don't read the field.

## SprocketStats-2.0

- `backend/endpoints/auth.py` `me()`: the `"offline_code": ""` line and its comment.
- `backend/tests/test_auth_me.py`: `test_me_sends_blank_offline_code_for_old_app_builds`.

Nothing in SprocketStats-Attendance.

Once both sections are done, delete this file.
