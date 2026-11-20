# Next update: remove the old-code warning

Member codes went from 16 digits (14x14 Data Matrix) to 24 digits (16x16), with a 2-digit header for format version and type (see the docstring at the top of `backend/core/member_codes.py`). This was a hard cutover. Phones only update when the member taps Reload, so for **one release** the old 16-digit codes are still recognized, only to tell the member to update the app.

**In the next update, delete all of it.** After that, an old code is just "some other Data Matrix", which the scanners ignore.

Every site is tagged `LEGACY-16-DIGIT`. Search both repos:

```
git grep -n "LEGACY-16-DIGIT"
```

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

Then delete this file.
