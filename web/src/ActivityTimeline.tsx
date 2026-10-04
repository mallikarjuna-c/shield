import { useEffect, useMemo, useState } from 'react'
import { FileText, Globe, KeyRound, Mail, Usb } from 'lucide-react'
import { api, type DayEvent, type DayEvents } from './api'
import { Card, cx } from './ui'

const LANES: { source: DayEvent['source']; label: string; icon: typeof Globe }[] = [
  { source: 'logon', label: 'Logon', icon: KeyRound },
  { source: 'device', label: 'USB', icon: Usb },
  { source: 'file', label: 'Files', icon: FileText },
  { source: 'email', label: 'Email', icon: Mail },
  { source: 'http', label: 'Web', icon: Globe },
]
const ICON = Object.fromEntries(LANES.map((l) => [l.source, l.icon])) as Record<DayEvent['source'], typeof Globe>
const TICKS = [0, 3, 6, 9, 12, 15, 18, 21, 24]

export default function ActivityTimeline({ user }: { user: string }) {
  const [data, setData] = useState<DayEvents | null>(null)
  const [hover, setHover] = useState<DayEvent | null>(null)
  const [all, setAll] = useState(false)

  useEffect(() => {
    setData(null)
    api.events(user).then(setData).catch(() => setData(null))
  }, [user])

  const flagged = useMemo(() => (data?.events ?? []).filter((e) => e.flags.length), [data])
  const groups = useMemo(() => {
    const out = new Map<string, DayEvent & { count: number; last: string }>()
    flagged.forEach((e) => {
      const key = `${e.source}|${e.text}|${e.flags.join()}`
      const g = out.get(key)
      if (g) { g.count += 1; g.last = e.time } else out.set(key, { ...e, count: 1, last: e.time })
    })
    return [...out.values()]
  }, [flagged])
  if (!data) return null
  if (!data.events.length) return null
  const [ws, we] = data.work_hours ?? [7, 19]

  return (
    <Card title="Activity timeline" subtitle={`${data.events.length} events · ${flagged.length} flagged · own PC ${data.primary_pc ?? '—'}`}>
      <div className="relative">
        <div className="ml-24">
          <div className="relative h-5 text-[10px] text-slate-500">
            {TICKS.map((t) => (
              <span key={t} className="absolute -translate-x-1/2 font-mono" style={{ left: `${(t / 24) * 100}%` }}>{String(t).padStart(2, '0')}:00</span>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          {LANES.map(({ source, label, icon: Icon }) => {
            const items = data.events.filter((e) => e.source === source)
            return (
              <div key={source} className="flex items-center">
                <div className="flex w-24 shrink-0 items-center gap-2 text-xs text-slate-400">
                  <Icon className="h-3.5 w-3.5 text-slate-500" />{label}
                  <span className="text-[10px] text-slate-600">{items.length || ''}</span>
                </div>
                <div className="relative h-8 flex-1 rounded-md bg-white/[0.03] ring-1 ring-inset ring-white/5">
                  <div className="absolute inset-y-0 bg-cyan-400/[0.05]" style={{ left: `${(ws / 24) * 100}%`, width: `${((we - ws) / 24) * 100}%` }} />
                  {TICKS.slice(1, -1).map((t) => (
                    <div key={t} className="absolute inset-y-0 w-px bg-white/5" style={{ left: `${(t / 24) * 100}%` }} />
                  ))}
                  {items.map((e, i) => {
                    const risky = e.flags.length > 0
                    return (
                      <button key={`${e.time}-${i}`} type="button" onMouseEnter={() => setHover(e)} onMouseLeave={() => setHover(null)}
                        className={cx('absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition',
                          risky ? 'z-10 h-3.5 w-3.5 bg-rose-400 shadow-[0_0_10px_2px_rgba(244,63,94,0.6)] ring-2 ring-rose-200/30 hover:scale-125'
                            : 'h-2 w-2 bg-cyan-300/60 hover:scale-150 hover:bg-cyan-200')}
                        style={{ left: `${(e.hour / 24) * 100}%` }} aria-label={`${e.time} ${e.text}`} />
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
        <div className="ml-24 mt-3 flex h-10 items-center gap-3 rounded-md bg-ink-950/60 px-3 text-xs ring-1 ring-inset ring-white/5">
          {hover ? (
            <>
              <span className="font-mono text-slate-300">{hover.time}</span>
              <span className="truncate text-slate-200">{hover.text}</span>
              {hover.flags.map((f) => <span key={f} className="shrink-0 rounded bg-rose-500/15 px-1.5 py-0.5 text-[11px] text-rose-300">{f}</span>)}
            </>
          ) : (
            <span className="flex items-center gap-4 text-slate-500">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-cyan-300/60" />Normal</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-rose-400" />Flagged</span>
              <span className="flex items-center gap-1.5"><span className="h-3 w-5 rounded-sm bg-cyan-400/10" />Working hours</span>
            </span>
          )}
        </div>
      </div>

      {flagged.length > 0 && (
        <div className="mt-6 border-t border-white/5 pt-5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Flagged events</span>
            {groups.length > 5 && (
              <button type="button" onClick={() => setAll((v) => !v)} className="text-xs text-cyan-300 hover:text-cyan-200">
                {all ? 'Show fewer' : `Show all ${groups.length}`}
              </button>
            )}
          </div>
          <table className="w-full table-fixed text-sm">
            <tbody className="divide-y divide-white/5">
              {(all ? groups : groups.slice(0, 5)).map((e, i) => {
                const Icon = ICON[e.source]
                return (
                  <tr key={`${e.time}-${i}`}>
                    <td className="w-36 py-2 font-mono text-xs text-slate-400">{e.count > 1 ? `${e.time.slice(0, 5)}–${e.last.slice(0, 5)}` : e.time}</td>
                    <td className="w-8 py-2"><Icon className="h-3.5 w-3.5 text-slate-500" /></td>
                    <td className="truncate py-2 pr-4 text-slate-300" title={e.text}>{e.text}{e.count > 1 && <span className="ml-2 text-xs text-slate-500">×{e.count}</span>}</td>
                    <td className="w-56 py-2 text-right">
                      {e.flags.map((f) => <span key={f} className="ml-1 rounded bg-rose-500/10 px-1.5 py-0.5 text-[11px] text-rose-300">{f}</span>)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
