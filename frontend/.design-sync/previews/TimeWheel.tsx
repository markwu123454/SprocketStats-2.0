import { useState } from 'react'
import { TimeWheel } from 'frontend'

const field: React.CSSProperties = { width: 240 }
const labelStyle: React.CSSProperties = { fontSize: 14, fontWeight: 600, marginBottom: 8 }

/** A single wheel — the field is a fixed 58px tall and fills its container's width. */
export function Default() {
  const [value, setValue] = useState('14:30')
  return (
    <div style={field}>
      <TimeWheel label="Clock in" value={value} onChange={setValue} />
    </div>
  )
}

/**
 * The AttendancePage pairing: clock in / clock out side by side.
 * This is the composition the component was built for.
 */
export function ClockInOut() {
  const [clockIn, setClockIn] = useState('15:45')
  const [clockOut, setClockOut] = useState('18:00')
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, width: 460 }}>
      <TimeWheel label="Clock in" value={clockIn} onChange={setClockIn} />
      <TimeWheel label="Clock out" value={clockOut} onChange={setClockOut} />
    </div>
  )
}

/** The ends of the supported range: 6:00 AM is the first slot, 11:55 PM the last. */
export function RangeBounds() {
  const [early, setEarly] = useState('06:00')
  const [late, setLate] = useState('23:55')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: 240 }}>
      <div>
        <div className="theme-subtext-color" style={labelStyle}>Earliest slot</div>
        <TimeWheel label="Start" value={early} onChange={setEarly} />
      </div>
      <div>
        <div className="theme-subtext-color" style={labelStyle}>Latest slot</div>
        <TimeWheel label="End" value={late} onChange={setLate} />
      </div>
    </div>
  )
}

/** The admin Meeting Hours editor: a labelled start/end pair for one meeting. */
export function MeetingHours() {
  const [start, setStart] = useState('16:00')
  const [end, setEnd] = useState('19:30')
  return (
    <div style={{ width: 460 }}>
      <div className="theme-h1-color" style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
        Thursday build meeting
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <TimeWheel label="Start" value={start} onChange={setStart} />
        <TimeWheel label="End" value={end} onChange={setEnd} />
      </div>
    </div>
  )
}
