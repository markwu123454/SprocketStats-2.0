import { useState } from 'react'
import { Checkbox } from 'frontend'

const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }

/** Off by default; click to toggle. */
export function Unchecked() {
  const [checked, setChecked] = useState(false)
  return (
    <label className="theme-text" style={row}>
      <Checkbox checked={checked} onChange={() => setChecked(v => !v)} />
      Include in this meeting
    </label>
  )
}

/** The accent fill marks a selected item. */
export function Checked() {
  const [checked, setChecked] = useState(true)
  return (
    <label className="theme-text" style={row}>
      <Checkbox checked={checked} onChange={() => setChecked(v => !v)} />
      Include in this meeting
    </label>
  )
}

/** A "select all" control when only some rows are selected. */
export function Indeterminate() {
  return (
    <label className="theme-text" style={row}>
      <Checkbox checked={false} indeterminate onChange={() => {}} />
      3 of 8 selected
    </label>
  )
}
