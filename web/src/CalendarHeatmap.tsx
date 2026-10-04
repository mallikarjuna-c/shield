import { useMemo, useState } from 'react'
import { cx, fmtDay } from './ui'

interface Day { day: string; alerts: number; high: number; active_users: number }

const WEEKDAYS = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function weekday(d: string) {
  return (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7
}

const SCALE = ['bg-cyan-900/70', 'bg-cyan-600/80', 'bg-amber-400/80', 'bg-orange-500', 'bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.7)]']

function score(d: Day) {
  return d.alerts + d.high
}

function shade(d: Day | null, cuts: number[]) {
  if (!d) return 'bg-transparent'
  if (!d.active_users) return 'bg-white/[0.02]'
  const s = score(d)
  if (!s) return 'bg-white/[0.06]'
  const level = cuts.filter((c) => s > c).length
  return SCALE[Math.min(level, SCALE.length - 1)]
}

function quantiles(values: number[]) {
  const v = [...values].sort((a, b) => a - b)
  if (!v.length) return [0, 0, 0, 0]
  return [0.25, 0.5, 0.75, 0.92].map((q) => v[Math.min(v.length - 1, Math.floor(q * v.length))])
}

export default function CalendarHeatmap({ series }: { series: Day[] }) {
  const [hover, setHover] = useState<Day | null>(null)
  const { weeks, months, cuts } = useMemo(() => {
    const cells: (Day | null)[] = [...Array(series.length ? weekday(series[0].day) : 0).fill(null), ...series]
    const weeks: (Day | null)[][] = []
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
    const months: { index: number; label: string }[] = []
    weeks.forEach((w, i) => {
      const first = w.find((d) => d && Number(d.day.slice(8)) <= 7)
      if (first && (!months.length || months[months.length - 1].label !== MONTHS[Number(first.day.slice(5, 7)) - 1])) {
        months.push({ index: i, label: MONTHS[Number(first.day.slice(5, 7)) - 1] })
      }
    })
    return { weeks, months, cuts: quantiles(series.filter((d) => score(d) > 0).map(score)) }
  }, [series])

  const cell = weeks.length > 60 ? 'h-3 w-3' : weeks.length > 26 ? 'h-3.5 w-3.5' : 'h-5 w-5'
  const step = weeks.length > 60 ? 15 : weeks.length > 26 ? 17 : 24

  return (
    <div>
      <div className="overflow-x-auto pb-2">
        <div className="inline-flex flex-col">
          <div className="relative ml-9 h-4 text-[10px] text-slate-500">
            {months.map((m) => <span key={`${m.label}-${m.index}`} className="absolute" style={{ left: m.index * step }}>{m.label}</span>)}
          </div>
          <div className="flex">
            <div className="mr-2 flex w-7 flex-col gap-[3px] text-[10px] text-slate-500">
              {WEEKDAYS.map((w, i) => <span key={i} className={cx('flex items-center', cell)}>{w}</span>)}
            </div>
            <div className="flex gap-[3px]">
              {weeks.map((w, i) => (
                <div key={i} className="flex flex-col gap-[3px]">
                  {Array.from({ length: 7 }).map((_, j) => {
                    const d = w[j] ?? null
                    return (
                      <div key={j} onMouseEnter={() => d && setHover(d)} onMouseLeave={() => setHover(null)}
                        className={cx('rounded-[3px] transition', cell, shade(d, cuts), d && 'hover:ring-2 hover:ring-cyan-300/70')} />
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-xs">
        <span className="h-5 text-slate-400">
          {hover
            ? <><span className="font-mono text-slate-200">{fmtDay(hover.day)}</span> · {hover.active_users ? `${hover.alerts} alert${hover.alerts === 1 ? '' : 's'} (${hover.high} high) · ${hover.active_users} employees active` : 'no activity (weekend or holiday)'}</>
            : 'Hover a day for details'}
        </span>
        <span className="flex items-center gap-1.5 text-slate-500">
          Fewer alerts <span className="h-3 w-3 rounded-[3px] bg-white/[0.06]" />
          {SCALE.map((c) => <span key={c} className={cx('h-3 w-3 rounded-[3px]', c)} />)}
          More alerts
        </span>
      </div>
    </div>
  )
}
