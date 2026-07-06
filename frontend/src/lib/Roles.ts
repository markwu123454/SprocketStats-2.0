// Role definitions (labels, control-panel access, school-info requirement) now
// live on the backend as the single source of truth (see backend/permissions.py).
// The current user's resolved policy arrives on `/auth/me` (`user.permissions`,
// read via `@/lib/permissions`); the full role catalog for the onboarding picker
// is fetched from `GET /roles`. Only the static grade/team-year enums remain here.

export const GRADE_OPTIONS = [
    { value: "freshman",  label: "Freshman"  },
    { value: "sophomore", label: "Sophomore" },
    { value: "junior",    label: "Junior"    },
    { value: "senior",    label: "Senior"    },
]

export const TEAM_YEAR_OPTIONS = [
    { value: "year_1", label: "Year 1" },
    { value: "year_2", label: "Year 2" },
    { value: "year_3", label: "Year 3" },
    { value: "year_4", label: "Year 4" },
]
