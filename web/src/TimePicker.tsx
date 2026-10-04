import { useEffect, useRef, useState } from 'react'
import { CalendarClock, ChevronDown, Radio } from 'lucide-react'
import { cx } from './ui'

export type TimeRange =
  | { kind: 'live'; label: string }
  | { kind: 'period'; label: string; start: string; end: string }

export const LIVE: TimeRange = { kind: 'live', label: 'Today (live)' }

const QUICK: [string, number | null][] = [
  ['Last 7 days', 7], ['Last 30 days', 30], ['Last 90 days', 90], ['Last 1 year', 365], ['All data', null],
]

export function shiftDay(d: string, days: number) {
  const t = new Date(`${d}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + days)
  return t.toISOString().slice(0, 10)
}

export function quickRange(label: string, days: number | null, first: string, last: string): TimeRange {
  return { kind: 'period', label, start: days === null ? first : shiftDay(last, -(days - 1)), end: last }
}

const FIELD = 'w-full rounded-md border border-white/10 bg-ink-950 px-2.5 py-1.5 font-mono text-sm text-slate-200 [color-scheme:dark] focus:border-cyan-500/40 focus:outline-none'

export default function TimePicker({ value, onChange, first, last }: {
  value: TimeRange
  onChange: (r: TimeRange) => void
  first: string
  last: string
}) {
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState(value.kind === 'period' ? value.start : shiftDay(last, -29))
  const [to, setTo] = useState(value.kind === 'period' ? value.end : last)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const pick = (r: TimeRange) => {
    onChange(r)
    setOpen(false)
  }

  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="flex h-9 items-center gap-2 rounded-md bg-white/5 px-3 text-sm text-slate-200 ring-1 ring-inset ring-white/10 hover:bg-white/10">
        {value.kind === 'live' ? <Radio className="h-4 w-4 text-emerald-400" /> : <CalendarClock className="h-4 w-4 text-cyan-300" />}
        <span>{value.label}</span>
        {value.kind === 'period' && <span className="font-mono text-xs text-slate-500">{value.start} → {value.end}</span>}
        <ChevronDown className="h-4 w-4 text-slate-500" />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 grid w-[34rem] grid-cols-2 rounded-lg border border-white/10 bg-ink-850 shadow-2xl shadow-black/50">
          <div className="border-r border-white/5 p-4">
            <div className="mb-3 text-[11px] font-medium uppercase tracking-wider text-slate-500">Absolute time range</div>
            <label className="mb-1 block text-xs text-slate-400">From</label>
            <input type="date" value={from} min={first} max={to} onChange={(e) => setFrom(e.target.value)} className={FIELD} />
            <label className="mb-1 mt-3 block text-xs text-slate-400">To</label>
            <input type="date" value={to} min={from} max={last} onChange={(e) => setTo(e.target.value)} className={FIELD} />
            <button type="button" disabled={!from || !to || from > to}
              onClick={() => pick({ kind: 'period', label: 'Custom range', start: from, end: to })}
              className="mt-4 w-full rounded-md bg-cyan-500/20 py-1.5 text-sm font-medium text-cyan-100 ring-1 ring-inset ring-cyan-400/40 hover:bg-cyan-500/30 disabled:opacity-40">
              Apply time range
            </button>
          </div>
          <div className="p-2">
            <div className="px-2 pb-2 pt-2 text-[11px] font-medium uppercase tracking-wider text-slate-500">Quick ranges</div>
            <button type="button" onClick={() => pick(LIVE)}
              className={cx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm', value.kind === 'live' ? 'bg-cyan-500/15 text-cyan-200' : 'text-slate-300 hover:bg-white/5')}>
              <Radio className="h-3.5 w-3.5 text-emerald-400" />Today (live)
            </button>
            {QUICK.map(([label, days]) => (
              <button key={label} type="button" onClick={() => pick(quickRange(label, days, first, last))}
                className={cx('block w-full rounded-md px-2 py-1.5 text-left text-sm', value.label === label ? 'bg-cyan-500/15 text-cyan-200' : 'text-slate-300 hover:bg-white/5')}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
