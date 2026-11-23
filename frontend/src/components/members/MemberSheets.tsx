// The Members page's edit sheets: profile, tags and kiosk access. The page draws
// them once, and both roster views (desktop grid, phone list) open them through
// MemberActions.

import { useEffect, useRef, useState } from "react"
import { Plus, ScanLine, X } from "lucide-react"
import Dropdown from "@/components/ui/Dropdown"
import Button from "@/components/ui/Button"
import FormFooter from "@/components/ui/FormFooter"
import Sheet from "@/components/ui/Sheet"
import Notice from "@/components/ui/Notice"
import type { RoleCatalogEntry } from "@/lib/permissions"
import { fieldErrorClass, fieldLabelClass, focusRing, helperClass, inputClass } from "@/lib/uiClasses"
import { useDiscardGuard, useIsDirty } from "@/lib/useDiscardGuard"
import {
    DROPDOWN_TRIGGER, GRADE_OPTIONS, TAG_RE, YEAR_OPTIONS,
    formatEnd, kioskGrantLabel, kioskGrantOf, nameOf, norm, pretty, tagChip,
    type EditableField, type MemberRow, type ProfilePatch,
} from "@/lib/members"

interface EditMemberSheetProps {
    member: MemberRow
    catalog: RoleCatalogEntry[]
    /** False for Leads: they can edit names/grade/year but the role stays locked. */
    canChangeRole: boolean
    onClose: () => void
    /** Saves the edited fields; resolves false if the person backed out of confirming, rejects with a message to show. */
    onSave: (patch: ProfilePatch) => Promise<boolean>
}

/** Profile editor — opened from a member's row (desktop) or sheet (mobile). Save closes it. */
export function EditMemberSheet({ member, catalog, canChangeRole, onClose, onSave }: EditMemberSheetProps) {
    const [draft, setDraft] = useState<Pick<MemberRow, EditableField>>({
        name: member.name, display_name: member.display_name, role: member.role,
        grade: member.grade, team_year: member.team_year,
    })
    const set = (patch: Partial<typeof draft>) => setDraft(d => ({ ...d, ...patch }))
    const dirty = useIsDirty(draft)
    const confirmDiscard = useDiscardGuard(dirty)
    const [saving, setSaving] = useState(false)
    const [saveError, setSaveError] = useState<string | null>(null)

    const save = async () => {
        setSaving(true)
        setSaveError(null)
        try {
            if (await onSave({ ...draft, name: norm(draft.name), display_name: norm(draft.display_name) })) onClose()
            else setSaving(false)
        } catch (e) {
            setSaveError(e instanceof Error ? e.message : "Couldn't save")
            setSaving(false)
        }
    }

    const fieldClass = `w-full ${inputClass}`
    // A student role needs a grade and year; a mentor moving to one has neither yet.
    const draftRole = draft.role ? catalog.find(c => c.value === draft.role) : undefined
    const missingSchoolInfo = !!draftRole?.school_info_required && (!draft.grade || !draft.team_year)
    const roleOptions = catalog.map(c => ({ value: c.value, label: c.label }))
    const enumOptions = (vals: string[]) => vals.map(v => ({ value: v, label: v ? pretty(v) : "—" }))

    return (
        <Sheet
            title={`Edit — ${member.name ?? member.display_name ?? member.email}`}
            onClose={onClose}
            dirty={dirty}
            footer={
                <FormFooter safeArea>
                    <Button variant="outlined" size="footer" className="ml-auto" disabled={saving} onClick={() => void confirmDiscard().then(ok => { if (ok) onClose() })}>Cancel</Button>
                    <Button size="footer" disabled={saving || !dirty} onClick={() => void save()}>
                        {saving ? "Saving…" : "Save"}
                    </Button>
                </FormFooter>
            }
        >
            <div className="flex flex-col gap-4">
                <label className={`flex flex-col gap-1.5 ${fieldLabelClass}`}>
                    Name
                    <input className={fieldClass} value={draft.name ?? ""} onChange={e => set({ name: e.target.value })} />
                </label>
                <label className={`flex flex-col gap-1.5 ${fieldLabelClass}`}>
                    Display name
                    <input className={fieldClass} value={draft.display_name ?? ""} onChange={e => set({ display_name: e.target.value })} />
                </label>
                <div className={`flex flex-col gap-1.5 ${fieldLabelClass}`}>
                    Role
                    <Dropdown value={draft.role ?? ""} options={roleOptions} onChange={v => set({ role: v })}
                              label="Role" placeholder="—" triggerClassName={DROPDOWN_TRIGGER} disabled={!canChangeRole} />
                    {!canChangeRole && <span className={`font-normal ${helperClass}`}>Only Captains, Mentors and the Scouting Lead can change roles.</span>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div className={`flex flex-col gap-1.5 ${fieldLabelClass}`}>
                        Grade
                        <Dropdown value={draft.grade ?? ""} options={enumOptions(GRADE_OPTIONS)} onChange={v => set({ grade: v })}
                                  label="Grade" triggerClassName={DROPDOWN_TRIGGER} />
                    </div>
                    <div className={`flex flex-col gap-1.5 ${fieldLabelClass}`}>
                        Year
                        <Dropdown value={draft.team_year ?? ""} options={enumOptions(YEAR_OPTIONS)} onChange={v => set({ team_year: v })}
                                  label="Year" triggerClassName={DROPDOWN_TRIGGER} />
                    </div>
                </div>
                {missingSchoolInfo && (
                    <p className={helperClass}>{draftRole!.label} is a student role. Add their grade and year.</p>
                )}

                {saveError && <Notice>{saveError}</Notice>}
            </div>
        </Sheet>
    )
}

interface TagsSheetProps {
    member: MemberRow
    onClose: () => void
    onAdd: (userId: string, tag: string) => Promise<void>
    onRemove: (userId: string, tag: string) => Promise<void>
}

export function TagsSheet({ member, onClose, onAdd, onRemove }: TagsSheetProps) {
    const [tags, setTags] = useState<string[]>(member.tags ?? [])
    const [input, setInput] = useState("")
    const [busy, setBusy] = useState(false)
    const [tagError, setTagError] = useState<string | null>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => { inputRef.current?.focus() }, [])

    async function handleAdd() {
        const tag = input.trim().toLowerCase()
        if (!TAG_RE.test(tag)) {
            setTagError("Lowercase letters, numbers, and underscores only (1–64 chars)")
            return
        }
        if (tags.includes(tag)) {
            setTagError("Tag already assigned")
            return
        }
        setTagError(null)
        setBusy(true)
        try {
            await onAdd(member.id, tag)
            setTags(prev => [...prev, tag].sort())
            setInput("")
        } catch (e) {
            setTagError(e instanceof Error ? e.message : "Couldn't add the tag")
        } finally {
            setBusy(false)
        }
    }

    async function handleRemove(tag: string) {
        setTagError(null)
        setBusy(true)
        try {
            await onRemove(member.id, tag)
            setTags(prev => prev.filter(t => t !== tag))
        } catch (e) {
            setTagError(e instanceof Error ? e.message : "Couldn't remove the tag")
        } finally {
            setBusy(false)
        }
    }

    return (
        <Sheet title={`Tags — ${member.display_name ?? member.name}`} onClose={onClose}>
            <div className="flex flex-col gap-4">
                <div className="flex flex-wrap gap-1.5 min-h-8">
                    {tags.length === 0 && (
                        <span className="text-xs theme-subtext-color">No tags yet</span>
                    )}
                    {tags.map(t => (
                        <span
                            key={t}
                            className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium"
                            style={{ background: "color-mix(in oklch, var(--theme-text-contrast) 15%, transparent)", color: "var(--theme-text-contrast)" }}
                        >
                            {t}
                            <button
                                onClick={() => void handleRemove(t)}
                                disabled={busy}
                                aria-label={`Remove tag ${t}`}
                                className={`rounded-full hover:opacity-60 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed ${focusRing}`}
                            >
                                <X size={14} />
                            </button>
                        </span>
                    ))}
                </div>

                <div className="flex gap-2">
                    <input
                        ref={inputRef}
                        value={input}
                        onChange={e => { setInput(e.target.value); setTagError(null) }}
                        onKeyDown={e => { if (e.key === "Enter") void handleAdd() }}
                        placeholder="new_tag"
                        aria-label="New tag"
                        disabled={busy}
                        className={`flex-1 min-w-0 ${inputClass}`}
                    />
                    <Button onClick={() => void handleAdd()} disabled={busy || !input.trim()}>
                        <Plus size={16} />
                        Add
                    </Button>
                </div>

                {tagError && (
                    <p className={fieldErrorClass}>{tagError}</p>
                )}
            </div>
        </Sheet>
    )
}

/** Preset kiosk grant lengths in minutes; null = no end. */
const KIOSK_PRESETS: { key: string; label: string; minutes: number | null }[] = [
    { key: "5m",   label: "5 min",  minutes: 5 },
    { key: "15m",  label: "15 min", minutes: 15 },
    { key: "1h",   label: "1 hr",   minutes: 60 },
    { key: "8h",   label: "8 hr",   minutes: 480 },
    { key: "none", label: "No end", minutes: null },
]

const CUSTOM_UNITS = [
    { value: "1",    label: "Minutes" },
    { value: "60",   label: "Hours" },
    { value: "1440", label: "Days" },
]

/** Mirrors the backend cap (KIOSK_ACCESS_MAX_MINUTES): one year. */
const KIOSK_MAX_MINUTES = 60 * 24 * 365

interface KioskAccessSheetProps {
    member: MemberRow
    onClose: () => void
    /** Minutes from now, null for no end, or "revoke". Rejects with a user-facing message. */
    onSubmit: (minutes: number | null | "revoke") => Promise<void>
}

/**
 * Grant a member kiosk access for a set time: they can scan member codes with
 * their phone and set up a kiosk by showing their own code.
 */
export function KioskAccessSheet({ member, onClose, onSubmit }: KioskAccessSheetProps) {
    const current = kioskGrantOf(member)
    const [choice, setChoice] = useState("1h")
    const [customAmount, setCustomAmount] = useState("30")
    const [customUnit, setCustomUnit] = useState("1")
    const [busy, setBusy] = useState(false)
    const [submitError, setSubmitError] = useState<string | null>(null)

    const firstName = (member.display_name ?? nameOf(member)).split(" ")[0]
    const amount = Number(customAmount)
    const customMinutes = Math.round(amount * Number(customUnit))
    const customInvalid = choice === "custom" && (!customAmount.trim() || !Number.isFinite(amount) || customMinutes < 1)
    const customTooLong = choice === "custom" && !customInvalid && customMinutes > KIOSK_MAX_MINUTES
    const minutes: number | null = choice === "custom"
        ? customMinutes
        : KIOSK_PRESETS.find(p => p.key === choice)?.minutes ?? null
    const endsAt = minutes == null ? null : new Date(Date.now() + minutes * 60_000)

    const run = async (value: number | null | "revoke") => {
        setBusy(true)
        setSubmitError(null)
        try {
            await onSubmit(value)
            onClose()
        } catch (e) {
            setSubmitError(e instanceof Error ? e.message : "Couldn't update kiosk access")
            setBusy(false)
        }
    }

    const chip = (key: string, label: string) => {
        const selected = choice === key
        return (
            <button
                key={key}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setChoice(key)}
                className={`min-h-11 md:min-h-10 px-3 rounded-lg border text-sm font-medium cursor-pointer transition-colors ${focusRing}`}
                style={selected
                    ? { ...tagChip, borderColor: "var(--theme-text-contrast)" }
                    : { borderColor: "var(--theme-border)", color: "var(--theme-text)" }}
            >
                {label}
            </button>
        )
    }

    return (
        <Sheet
            title={`Kiosk access — ${nameOf(member)}`}
            onClose={onClose}
            footer={
                <FormFooter safeArea>
                    {current && (
                        <Button variant="dangerOutlined" size="footer" className="mr-auto" disabled={busy} onClick={() => void run("revoke")}>
                            Revoke
                        </Button>
                    )}
                    <Button variant="outlined" size="footer" className={current ? "" : "ml-auto"} onClick={onClose} disabled={busy}>
                        Cancel
                    </Button>
                    <Button size="footer" disabled={busy || customInvalid || customTooLong} onClick={() => void run(minutes)}>
                        {busy ? "Saving…" : current ? "Update" : "Grant"}
                    </Button>
                </FormFooter>
            }
        >
            <div className="flex flex-col gap-4">
                <p className="text-sm theme-text">
                    Lets {firstName} scan member codes to check people in, and set up a kiosk by showing their own code.
                </p>

                {current && (
                    <div className="flex items-center gap-2 rounded-xl border theme-border px-4 py-2.5">
                        <ScanLine size={16} className="shrink-0 theme-text-contrast" aria-hidden />
                        <span className="text-sm theme-text">
                            Has access now · <span className="theme-subtext-color">{kioskGrantLabel(current)}</span>
                        </span>
                    </div>
                )}

                <div className={`flex flex-col gap-1.5 ${fieldLabelClass}`}>
                    <span id="kiosk-duration-label">Duration</span>
                    <div role="radiogroup" aria-labelledby="kiosk-duration-label" className="grid grid-cols-3 gap-2 font-normal">
                        {KIOSK_PRESETS.map(p => chip(p.key, p.label))}
                        {chip("custom", "Custom")}
                    </div>
                </div>

                {choice === "custom" && (
                    <div className="grid grid-cols-2 gap-3">
                        <label className={`flex flex-col gap-1.5 ${fieldLabelClass}`}>
                            Amount
                            <input
                                type="number"
                                inputMode="decimal"
                                min={1}
                                step="any"
                                value={customAmount}
                                onChange={e => setCustomAmount(e.target.value)}
                                className={`w-full ${inputClass}`}
                                aria-invalid={customInvalid || customTooLong}
                            />
                        </label>
                        <div className={`flex flex-col gap-1.5 ${fieldLabelClass}`}>
                            Unit
                            <Dropdown value={customUnit} options={CUSTOM_UNITS} onChange={setCustomUnit}
                                      label="Unit" triggerClassName={DROPDOWN_TRIGGER} />
                        </div>
                    </div>
                )}

                {customInvalid ? <p className={fieldErrorClass}>Enter a length of at least 1 minute.</p>
                    : customTooLong ? <p className={fieldErrorClass}>Up to 365 days — pick No end for longer.</p>
                    : endsAt && (
                        <p className={helperClass}>
                            Ends {formatEnd(endsAt)}. Kiosks {firstName} sets up stop working when access ends.
                        </p>
                    )}

                {submitError && <Notice>{submitError}</Notice>}
            </div>
        </Sheet>
    )
}
