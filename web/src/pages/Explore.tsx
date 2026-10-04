import { useEffect, useState } from 'react'
import { Radio, Search } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, type Meta, type MonitoredUser, type Truth, type UserHistory } from '../api'
import { Card, Empty, fmtDay, LevelBadge, PctBadge, Reasons, StageBadge, StageTrack, ThresholdLegend, TOOLTIP, TruthBadge, cx } from '../ui'
import ActivityTimeline from '../ActivityTimeline'
import { shiftDay, type TimeRange } from '../TimePicker'


function Label({ children }: { children: string }) {
  return <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-slate-500">{children}</div>
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500">{label}</span>
      {children}
    </div>
  )
}

export default function ExplorePage({ meta, range, evalMode, user, onUser }: {
  meta: Meta
  range: TimeRange
  evalMode: boolean
  user: string | null
  onUser: (u: string) => void
}) {
  const [query, setQuery] = useState(user ?? '')
  const [hits, setHits] = useState<{ user: string; role: string | null }[]>([])
  const [history, setHistory] = useState<UserHistory | null>(null)
  const [live, setLive] = useState<MonitoredUser | null>(null)
  const [flagged, setFlagged] = useState<MonitoredUser[]>([])
  const [answers, setAnswers] = useState<Record<string, Truth> | null>(null)
  const [truth, setTruth] = useState<Truth | null>(null)
  const [error, setError] = useState<string | null>(null)

  const start = range.kind === 'live' ? shiftDay(meta.replay_day, -29) : range.start
  const end = range.kind === 'live' ? meta.replay_day : range.end
  const includesToday = start <= meta.replay_day && meta.replay_day <= end

  useEffect(() => {
    if (!query.trim() || query === user) return setHits([])
    const ctl = new AbortController()
    const id = setTimeout(() => api.users(query.trim(), ctl.signal).then(setHits).catch(() => {}), 150)
    return () => { clearTimeout(id); ctl.abort() }
  }, [query, user])

  useEffect(() => {
    api.realtime(evalMode).then((r) => {
      setFlagged((r.latest?.users ?? []).filter((u) => u.level !== 'Normal').sort((a, b) => b.risk - a.risk))
      setLive(user ? r.latest?.users.find((u) => u.user === user) ?? null : null)
      setTruth(user ? r.truth?.[user] ?? null : null)
      setAnswers(r.truth)
    }).catch(() => setLive(null))
  }, [user, evalMode])

  useEffect(() => {
    if (!user) return
    setHistory(null)
    setError(null)
    api.userHistory(user, start, end).then(setHistory).catch((e) => setError(String(e.message)))
  }, [user, start, end])

  const showToday = Boolean(user && live && includesToday)
  const earlier = history ? history.alerts.filter((a) => !(showToday && a.day === meta.replay_day)) : []

  const pick = (u: string) => {
    onUser(u)
    setQuery(u)
    setHits([])
  }

  const search = (
    <div className="relative w-full sm:w-80">
      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
      <input value={query} onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && query.trim()) pick(hits[0]?.user ?? query.trim().toUpperCase()) }}
        onBlur={() => setTimeout(() => setHits([]), 150)}
        placeholder="Search employee ID" spellCheck={false}
        className="h-9 w-full rounded-md border border-white/10 bg-ink-900 pl-9 pr-3 font-mono text-sm text-slate-200 placeholder:font-sans placeholder:text-slate-600 focus:border-cyan-500/40 focus:outline-none" />
      {hits.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-white/10 bg-ink-850 py-1 shadow-xl">
          {hits.map((h) => (
            <li key={h.user}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(h.user)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-white/5">
                <span className="font-mono text-slate-200">{h.user}</span><span className="truncate text-xs text-slate-500">{h.role}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className={cx('text-xl font-semibold text-slate-100', user && 'font-mono')}>{user ?? 'Explore'}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {user ? <>{history?.role ?? live?.role ?? 'Employee'} · {fmtDay(start)} → {fmtDay(end)}</> : 'Investigate one employee over the selected time range'}
          </p>
          {history && (
            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
              <Fact label="Peak risk"><PctBadge pct={history.peak_pct} level={history.peak_level} /><LevelBadge level={history.peak_level} /></Fact>
              <Fact label="Highest stage">{history.max_stage > 0 ? <StageBadge stage={history.max_stage} /> : <span className="text-xs text-slate-400">None</span>}</Fact>
              <Fact label="Alert days"><span className="text-sm font-semibold tabular-nums text-slate-200">{history.alerts.length}<span className="font-normal text-slate-500"> / {history.series.length}</span></span></Fact>
            </div>
          )}
        </div>
        {search}
      </div>

      {!user && (
        <Card title="Flagged today" right={<span className="text-xs text-slate-500">{flagged.length} employees</span>} pad={false}>
          {flagged.length === 0 ? <Empty>No employees flagged today. Search for any employee ID above.</Empty> : (
            <ul className="divide-y divide-white/5">
              {flagged.map((u) => (
                <li key={u.user}>
                  <button type="button" onClick={() => pick(u.user)} className="flex w-full items-center gap-4 px-5 py-3 text-left hover:bg-white/[0.03]">
                    <span className="w-20 font-mono text-sm text-slate-200">{u.user}</span>
                    <span className="hidden w-48 truncate text-xs text-slate-500 md:block">{u.role}</span>
                    <span className="flex items-center gap-2"><LevelBadge level={u.level} /><PctBadge pct={u.percentile} level={u.level} /></span>
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-400">{u.reasons[0]?.reason}</span>
                    <span className="w-24 text-right">{u.stage > 0 && <StageBadge stage={u.stage} />}</span>
                    {evalMode && answers?.[u.user] && <TruthBadge attacker={answers[u.user].attacker} />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {user && error && <Card><Empty>{error}</Empty></Card>}

      {showToday && live && (
        <Card title={<span className="flex items-center gap-2"><Radio className="h-4 w-4 text-emerald-400" />Today</span>}
          subtitle={`${live.events.toLocaleString()} events · ${live.percentile.toFixed(2)} percentile`}
          right={<div className="flex items-center gap-2">{evalMode && truth && <TruthBadge attacker={truth.attacker} />}<LevelBadge level={live.level} /><StageBadge stage={live.stage} /></div>}>
          <div className="max-w-3xl">
            <Label>Why</Label>
            {live.reasons.length ? <Reasons reasons={live.reasons} /> : <p className="text-sm text-slate-400">Behaviour so far matches this employee's normal pattern.</p>}
          </div>
          {evalMode && truth && (
            <div className="mt-4"><TruthBadge attacker={truth.attacker} label={truth.attacker ? `Ground truth: attacker, replay of ${truth.replayed_insider}` : 'Ground truth: normal employee'} /></div>
          )}
          <div className="mt-6 border-t border-white/5 pt-5"><Label>Attack stages, last 30 days</Label><StageTrack firsts={live.stage_first} current={live.stage} /></div>
        </Card>
      )}

      {user && includesToday && <ActivityTimeline user={user} />}

      {user && !error && !history && <Empty>Loading…</Empty>}
      {history && (
        <>

          <Card title="Daily risk" subtitle="Percentile of all 2010–2011 employee-days"
            right={<ThresholdLegend />}>
            <div className="h-52">
              <ResponsiveContainer>
                <AreaChart data={history.series} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
                  <defs><linearGradient id="ef" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f43f5e" stopOpacity={0.45} /><stop offset="100%" stopColor="#f43f5e" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} minTickGap={36} tickLine={false} axisLine={false} />
                  <YAxis domain={[80, 100]} ticks={[80, 90, 98, 100]} allowDataOverflow tickLine={false} axisLine={false} />
                  <ReferenceLine y={98} stroke="#38bdf8" strokeDasharray="3 4" />
                  <ReferenceLine y={99} stroke="#f59e0b" strokeDasharray="3 4" />
                  <ReferenceLine y={99.8} stroke="#f43f5e" strokeDasharray="3 4" />
                  <Tooltip contentStyle={TOOLTIP} labelFormatter={(d) => fmtDay(String(d))} formatter={(v) => `${Number(v).toFixed(2)} percentile`} />
                  <Area type="stepAfter" dataKey="pct" name="Risk" baseValue={80} stroke="#f43f5e" strokeWidth={1.5} fill="url(#ef)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title={showToday ? 'Earlier alerts' : 'Alerts'} right={<span className="text-xs text-slate-500">{earlier.length} {earlier.length === 1 ? 'day' : 'days'}</span>} pad={false}>
            {earlier.length === 0 ? <Empty>No {showToday ? 'earlier ' : ''}Medium or High days in this time range</Empty> : (
              <ol className="divide-y divide-white/5">
                {earlier.map((a) => (
                  <li key={a.day} className="flex gap-4 px-5 py-3">
                    <div className="w-24 shrink-0 pt-0.5 font-mono text-xs text-slate-400">{a.day}</div>
                    <div className="flex shrink-0 items-start gap-2"><LevelBadge level={a.level} /><PctBadge pct={a.pct} level={a.level} /></div>
                    <p className="min-w-0 flex-1 text-sm leading-relaxed text-slate-300">{a.story.split(': ').slice(1).join(': ') || a.story}</p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
