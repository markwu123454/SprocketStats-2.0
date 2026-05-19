export interface RoleOption {
    value: string
    label: string
    controlPanel: boolean
    hasSchoolInfo: boolean
}

export const ROLE_OPTIONS: RoleOption[] = [
    { value: "cad_member",           label: "CAD Member",             controlPanel: false, hasSchoolInfo: true  },
    { value: "cad_lead",             label: "CAD Lead",               controlPanel: true,  hasSchoolInfo: true  },
    { value: "manufacturing_member", label: "Manufacturing Member",   controlPanel: false, hasSchoolInfo: true  },
    { value: "manufacturing_lead",   label: "Manufacturing Lead",     controlPanel: true,  hasSchoolInfo: true  },
    { value: "programming_member",   label: "Programming Member",     controlPanel: false, hasSchoolInfo: true  },
    { value: "programming_lead",     label: "Programming Lead",       controlPanel: true,  hasSchoolInfo: true  },
    { value: "scouting_member",      label: "Scouting Member",        controlPanel: false, hasSchoolInfo: true  },
    { value: "scouting_lead",        label: "Scouting Lead",          controlPanel: true,  hasSchoolInfo: true  },
    { value: "publicity_member",     label: "Publicity Member",       controlPanel: false, hasSchoolInfo: true  },
    { value: "publicity_lead",       label: "Publicity Lead",         controlPanel: true,  hasSchoolInfo: true  },
    { value: "operations_member",    label: "Operations Member",      controlPanel: false, hasSchoolInfo: true  },
    { value: "operations_lead",      label: "Operations Lead",        controlPanel: true,  hasSchoolInfo: true  },
    { value: "outreach_member",      label: "Outreach Member",        controlPanel: false, hasSchoolInfo: true  },
    { value: "outreach_lead",        label: "Outreach Lead",          controlPanel: true,  hasSchoolInfo: true  },
    { value: "captain",              label: "Captain",                controlPanel: true,  hasSchoolInfo: true  },
    { value: "mentor",               label: "Mentor",                 controlPanel: true,  hasSchoolInfo: false },
    { value: "alumni",               label: "Alumni",                 controlPanel: false, hasSchoolInfo: false },
]

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

export function formatRole(role: string): string {
    return ROLE_OPTIONS.find(o => o.value === role)?.label ?? role
}

export function hasControlPanelAccess(role?: string | null): boolean {
    if (!role) return false
    return ROLE_OPTIONS.find(o => o.value === role)?.controlPanel ?? false
}

export function needsSchoolInfo(role?: string | null): boolean {
    if (!role) return false
    return ROLE_OPTIONS.find(o => o.value === role)?.hasSchoolInfo ?? true
}

export const ROLES_WITHOUT_SCHOOL_INFO = new Set(
    ROLE_OPTIONS.filter(o => !o.hasSchoolInfo).map(o => o.value)
)