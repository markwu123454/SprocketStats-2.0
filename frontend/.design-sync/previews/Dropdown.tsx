import { useState } from 'react'
import { Dropdown } from 'frontend'

// The app's own trigger idiom, taken from `SimpleDropdown` in
// OnboardingShared.tsx — `Dropdown` ships no trigger chrome of its own, so the
// border/padding/colors always come from `triggerClassName`.
const TRIGGER =
  'rounded-lg border px-3 py-2.5 text-sm transition theme-bg theme-border theme-text'

const ROLE_OPTIONS = [
  { value: 'build', label: 'Build' },
  { value: 'programming', label: 'Programming' },
  { value: 'drive', label: 'Drive Team' },
  { value: 'scouting', label: 'Scouting' },
  { value: 'business', label: 'Business' },
]

const field: React.CSSProperties = { width: 280, display: 'flex', flexDirection: 'column', gap: 8 }
const labelStyle: React.CSSProperties = { fontSize: 14, fontWeight: 600 }

/** A role picker with a selection — the canonical use. */
export function Selected() {
  const [value, setValue] = useState('scouting')
  return (
    <div style={field}>
      <label className="theme-h1-color" style={labelStyle}>
        What's your role on Team Sprocket?
      </label>
      <Dropdown
        value={value}
        options={ROLE_OPTIONS}
        onChange={setValue}
        triggerClassName={TRIGGER}
      />
    </div>
  )
}

/** Nothing selected yet — the placeholder renders in the muted subtext color. */
export function Placeholder() {
  const [value, setValue] = useState('')
  return (
    <div style={field}>
      <label className="theme-h1-color" style={labelStyle}>
        What grade are you in?
      </label>
      <Dropdown
        value={value}
        options={[
          { value: '9', label: 'Freshman' },
          { value: '10', label: 'Sophomore' },
          { value: '11', label: 'Junior' },
          { value: '12', label: 'Senior' },
        ]}
        onChange={setValue}
        placeholder="Select your grade…"
        triggerClassName={`${TRIGGER} theme-subtext-color`}
      />
    </div>
  )
}

/** Disabled — the trigger dims to 60% and will not open. */
export function Disabled() {
  return (
    <div style={field}>
      <label className="theme-h1-color" style={labelStyle}>
        Alliance (locked once scouting opens)
      </label>
      <Dropdown
        value="red"
        options={[
          { value: 'red', label: 'Red Alliance' },
          { value: 'blue', label: 'Blue Alliance' },
        ]}
        onChange={() => {}}
        disabled
        triggerClassName={TRIGGER}
      />
    </div>
  )
}

/** Several dropdowns in a form column, the way the onboarding flow stacks them. */
export function InAForm() {
  const [role, setRole] = useState('build')
  const [year, setYear] = useState('2')
  return (
    <div style={{ width: 280, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={field}>
        <label className="theme-h1-color" style={labelStyle}>Role</label>
        <Dropdown value={role} options={ROLE_OPTIONS} onChange={setRole} triggerClassName={TRIGGER} />
      </div>
      <div style={field}>
        <label className="theme-h1-color" style={labelStyle}>Year on the team</label>
        <Dropdown
          value={year}
          options={[
            { value: '1', label: 'First year' },
            { value: '2', label: 'Second year' },
            { value: '3', label: 'Third year' },
            { value: '4', label: 'Fourth year' },
          ]}
          onChange={setYear}
          triggerClassName={TRIGGER}
        />
      </div>
    </div>
  )
}
