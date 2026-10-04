import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Compass, Database, ShieldAlert } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, type HistoryData, type Meta, type MonitoredUser, type Realtime, type Truth } from '../api'
import { Button, Card, Empty, fmtDay, LevelBadge, PctBadge, Reasons, STAGE_NAMES, STAGE_STYLE, StageBadge, StageTrack, ThresholdLegend, TOOLTIP, TruthBadge, cx } from '../ui'
import { PALETTE, Trend } from '../signals'
import type { TimeRange } from '../TimePicker'
import CalendarHeatmap from '../CalendarHeatmap'
import WelcomeBanner from '../WelcomeBanner'

function StageDistribution({ counts, note }: { counts: Record<string, number>; note: string }) {
  const max = Math.max(1, ...STAGE_NAMES.slice(1).map((s) => counts[s] ?? 0))
  return (
    <>
      <ul className="space-y-3">
        {STAGE_NAMES.slice(1).map((name, i) => {
          const n = counts[name] ?? 0
          const s = STAGE_STYLE[i + 1]
          return (
            <li key={name}>
              <div className="mb-1 flex justify-between text-xs"><span className={s.text}>{i + 1}. {name}</span><span className="tabular-nums text-slate-400">{n}</span></div>
              <div className="h-2 rounded-full bg-white/5"><div className={cx('h-2 rounded-full', s.dot)} style={{ width: `${(n / max) * 100}%`, opacity: n ? 0.85 : 0 }} /></div>
            </li>
          )
        })}
      </ul>
      <p className="mt-4 text-xs text-slate-500">{note}</p>
    </>
  )
}

const THREAT = {
  Critical: { text: 'text-rose-300', ring: 'ring-rose-500/40', bg: 'from-rose-500/20', dot: 'bg-rose-400' },
  Elevated: { text: 'text-amber-300', ring: 'ring-amber-500/40', bg: 'from-amber-500/15', dot: 'bg-amber-400' },
  Guarded: { text: 'text-sky-300', ring: 'ring-sky-500/40', bg: 'from-sky-500/15', dot: 'bg-sky-400' },
  Normal: { text: 'text-emerald-300', ring: 'ring-emerald-500/40', bg: 'from-emerald-500/15', dot: 'bg-emerald-400' },
}

function threatLevel(high: number, medium: number, watch: number): keyof typeof THREAT {
  return high ? 'Critical' : medium ? 'Elevated' : watch ? 'Guarded' : 'Normal'
}

interface Stat {
  label: string
  value: ReactNode
  hint: string
  tone?: 'default' | 'danger' | 'warn' | 'info' | 'ok'
}

const TONE = { default: 'text-slate-100', danger: 'text-rose-400', warn: 'text-amber-300', info: 'text-cyan-300', ok: 'text-emerald-400' }

function StatusHeader({ eyebrow, title, subtitle, level, message, action, stats }: {
  eyebrow: ReactNode
  title: string
  subtitle: ReactNode
  level: keyof typeof THREAT
  message: string
  action?: ReactNode
  stats: Stat[]
}) {
  const t = THREAT[level]
  return (
    <section className="relative overflow-hidden rounded-2xl border border-cyan-400/15 bg-ink-900/80 shadow-[0_10px_40px_-16px_rgba(34,211,238,0.35)]">
      <div className="cyber-grid pointer-events-none absolute inset-0 opacity-50 [mask-image:linear-gradient(90deg,black,transparent_70%)]" />
      <div className={cx('pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-gradient-to-br to-transparent blur-3xl', t.bg)} />
      <div className="relative grid gap-6 p-6 lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-300/80">{eyebrow}</div>
          <h1 className="mt-2 text-2xl font-bold text-slate-50">{title}</h1>
          <div className="mt-2 text-sm text-slate-400">{subtitle}</div>
        </div>
        <div className="flex flex-wrap items-center gap-5">
          <div className={cx('flex items-center gap-4 rounded-xl bg-ink-950/70 px-5 py-4 ring-1 ring-inset', t.ring)}>
            <ShieldAlert className={cx('h-9 w-9', t.text)} />
            <div>
              <div className="text-[11px] uppercase tracking-wider text-slate-500">Threat level</div>
              <div className={cx('font-display flex items-center gap-2 text-xl font-bold', t.text)}>
                <span className={cx('h-2 w-2 animate-pulse rounded-full', t.dot)} />{level}
              </div>
              <div className="mt-0.5 text-xs text-slate-400">{message}</div>
            </div>
          </div>
          {action}
        </div>
      </div>
      <dl className="relative grid grid-cols-2 border-t border-cyan-400/10 sm:grid-cols-3 xl:grid-cols-5">
        {stats.map(({ label, value, hint, tone }, i) => (
          <div key={label} className={cx('px-6 py-4', i > 0 && 'xl:border-l xl:border-cyan-400/10')}>
            <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</dt>
            <dd className={cx('font-display mt-1.5 text-3xl font-semibold tabular-nums', TONE[tone ?? 'default'])}>{value}</dd>
            <dd className="mt-0.5 text-xs text-slate-500">{hint}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

const SCENARIOS: Record<number, string> = { 1: 'Data leak', 2: 'Theft before quitting', 3: 'Rogue admin' }

function EvalNote({ children }: { children: ReactNode }) {
  return <span className="rounded bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-200 ring-1 ring-inset ring-amber-500/25">{children}</span>
}

function LiveEvaluation({ users, truth, onExplore }: { users: MonitoredUser[]; truth: Record<string, Truth>; onExplore: (u: string) => void }) {
  const attackers = users.filter((u) => truth[u.user]?.attacker)
  const flagged = users.filter((u) => u.level !== 'Normal')
  const caught = attackers.filter((u) => u.level !== 'Normal').length
  const falseAlarms = flagged.filter((u) => !truth[u.user]?.attacker).length
  return (
    <Card title="Ground truth" subtitle="Shield's results compared with the replay answer key"
      right={<EvalNote>Evaluation only, not available in real use</EvalNote>} pad={false}>
      <div className="grid grid-cols-3 border-b border-white/5">
        {[
          ['Attackers caught', `${caught} / ${attackers.length}`, caught === attackers.length ? 'text-emerald-300' : 'text-amber-300'],
          ['Flagged employees', String(flagged.length), 'text-slate-100'],
          ['False alarms', String(falseAlarms), falseAlarms ? 'text-amber-300' : 'text-emerald-300'],
        ].map(([label, value, tone], i) => (
          <div key={label} className={cx('px-5 py-3', i > 0 && 'border-l border-white/5')}>
            <div className="text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
            <div className={cx('font-display mt-1 text-2xl font-semibold tabular-nums', tone)}>{value}</div>
          </div>
        ))}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
            <th className="px-5 py-2.5 font-medium">Attacker</th>
            <th className="px-3 py-2.5 font-medium">Replayed attack</th>
            <th className="px-3 py-2.5 font-medium">Rank</th>
            <th className="px-3 py-2.5 font-medium">Risk</th>
            <th className="px-3 py-2.5 font-medium">Stage</th>
            <th className="px-5 py-2.5 font-medium">Result</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {attackers.map((u) => {
            const t = truth[u.user]
            return (
              <tr key={u.user} onClick={() => onExplore(u.user)} className="cursor-pointer hover:bg-white/[0.02]">
                <td className="px-5 py-2.5 font-mono text-[13px] text-slate-100">{u.user}</td>
                <td className="px-3 py-2.5 text-xs text-slate-400">{t.scenario ? SCENARIOS[t.scenario] : '—'} <span className="font-mono text-slate-500">({t.replayed_insider})</span></td>
                <td className="px-3 py-2.5 font-mono text-xs text-slate-300">#{users.indexOf(u) + 1} of {users.length}</td>
                <td className="px-3 py-2.5"><span className="flex items-center gap-1.5"><PctBadge pct={u.percentile} level={u.level} />{u.level !== 'Normal' && <LevelBadge level={u.level} />}</span></td>
                <td className="px-3 py-2.5">{u.stage > 0 ? <StageBadge stage={u.stage} /> : <span className="text-slate-600">—</span>}</td>
                <td className="px-5 py-2.5">{u.level !== 'Normal' ? <TruthBadge attacker={false} label="Caught" /> : <TruthBadge attacker label="Missed so far" />}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Card>
  )
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function LiveView({ meta, evalMode, onExplore, onDataSources }: { meta: Meta; evalMode: boolean; onExplore: (u: string) => void; onDataSources: () => void }) {
  const [data, setData] = useState<Realtime | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [onlyFlagged, setOnlyFlagged] = useState(false)

  useEffect(() => { api.realtime(evalMode).then(setData).catch(() => {}) }, [evalMode])

  const latest = data?.latest
  const users = useMemo(() => (latest?.users ?? []).filter((u) => !onlyFlagged || u.level !== 'Normal' || u.stage >= 3), [latest, onlyFlagged])
  const current = latest?.users.find((u) => u.user === selected) ?? users[0]
  const watched = useMemo(() => {
    const peak: Record<string, number> = {}
    data?.timeline.forEach((t) => Object.entries(t.percentiles).forEach(([u, r]) => (peak[u] = Math.max(peak[u] ?? 0, r))))
    return Object.entries(peak).filter(([, r]) => r >= 98).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([u]) => u)
  }, [data])
  const chart = useMemo(() => (data?.timeline ?? []).map((t) => ({ as_of: t.as_of, ...Object.fromEntries(watched.map((u) => [u, Math.max(t.percentiles[u] ?? 0, 80)])) })), [data, watched])

  if (!data) return <Empty>Loading…</Empty>
  if (!latest) {
    return (
      <Card>
        <div className="py-14 text-center">
          <Database className="mx-auto h-8 w-8 text-cyan-400/60" />
          <p className="mt-3 text-sm text-slate-300">No activity received for {fmtDay(meta.replay_day)} yet.</p>
          <p className="mt-1 text-xs text-slate-500">Upload the day's first log file to start live monitoring.</p>
          <div className="mt-5"><Button tone="primary" onClick={onDataSources}><Database className="h-4 w-4" />Go to Data sources</Button></div>
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <StatusHeader
        eyebrow={<span className="flex items-center gap-2"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />Live monitoring</span>}
        title={`Today · ${fmtDay(meta.replay_day)}`}
        subtitle={<>{latest.total_events.toLocaleString()} events received · data up to <span className="font-mono text-slate-200">{latest.as_of}</span></>}
        level={threatLevel(latest.summary.high, latest.summary.medium, latest.summary.watch)}
        message={latest.summary.high + latest.summary.medium
          ? `${plural(latest.summary.high + latest.summary.medium, 'employee')} need attention`
          : latest.summary.watch ? `${latest.summary.watch} on the watch list` : 'Every employee within their normal pattern'}
        action={users[0] && users[0].level !== 'Normal'
          ? <Button tone="primary" onClick={() => onExplore(users[0].user)}><Compass className="h-4 w-4" />Explore {users[0].user}</Button>
          : <Button onClick={onDataSources}><Database className="h-4 w-4" />Upload data</Button>}
        stats={[
          { label: 'Monitored', value: latest.summary.monitored, hint: 'employees' },
          { label: 'High', value: latest.summary.high, hint: 'top 0.2%', tone: latest.summary.high ? 'danger' : 'ok' },
          { label: 'Medium', value: latest.summary.medium, hint: 'top 1%', tone: latest.summary.medium ? 'warn' : 'ok' },
          { label: 'Watch', value: latest.summary.watch, hint: 'top 2%', tone: latest.summary.watch ? 'info' : 'ok' },
          { label: 'Staging or beyond', value: latest.summary.staging_plus, hint: 'attack stage 3+', tone: latest.summary.staging_plus ? 'danger' : 'ok' },
        ]}
      />

      {evalMode && data.truth && <LiveEvaluation users={latest.users} truth={data.truth} onExplore={onExplore} />}

      <Card title="Risk through the day" subtitle="Percentile after each upload, for employees who reached Watch" right={<ThresholdLegend />}>
        {watched.length === 0 ? <Empty>Nobody has reached the Watch level so far.</Empty> : (
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={chart} margin={{ top: 6, right: 16, left: -20, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="as_of" tickLine={false} axisLine={false} />
                <YAxis domain={[80, 100]} ticks={[80, 90, 98, 100]} tickLine={false} axisLine={false} />
                <ReferenceLine y={98} stroke="#38bdf8" strokeDasharray="3 4" />
                <ReferenceLine y={99} stroke="#f59e0b" strokeDasharray="3 4" />
                <ReferenceLine y={99.8} stroke="#f43f5e" strokeDasharray="3 4" />
                <Tooltip contentStyle={TOOLTIP} formatter={(v) => `${Number(v).toFixed(2)} percentile`} labelFormatter={(l) => `Data up to ${l}`} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
                {watched.map((u, i) => <Line key={u} dataKey={u} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <div className="grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3" pad={false} title={`Employees (${users.length})`}
          right={
            <div className="flex rounded-lg bg-white/5 p-0.5 text-xs">
              {([[false, 'All'], [true, 'Flagged']] as const).map(([v, l]) => (
                <button key={l} type="button" onClick={() => setOnlyFlagged(v)}
                  className={cx('rounded-md px-2.5 py-1', onlyFlagged === v ? 'bg-cyan-500/20 text-cyan-200' : 'text-slate-400 hover:text-slate-200')}>{l}</button>
              ))}
            </div>
          }>
          <div className="max-h-[38rem] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-ink-900">
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-2.5 font-medium">Employee</th>
                  <th className="px-3 py-2.5 font-medium" title="Percentile vs. all 2010–2011 employee-days">Risk</th>
                  <th className="px-3 py-2.5 font-medium">Level</th>
                  <th className="px-3 py-2.5 font-medium">Stage</th>
                  <th className="px-3 py-2.5 font-medium">Main reason</th>
                  {evalMode && <th className="px-3 py-2.5 font-medium">Truth</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {users.map((u) => {
                  const truth = data.truth?.[u.user]
                  return (
                    <tr key={u.user} onClick={() => setSelected(u.user)}
                      className={cx('cursor-pointer', current?.user === u.user ? 'bg-cyan-500/[0.07]' : 'hover:bg-white/[0.02]')}>
                      <td className="px-5 py-2.5">
                        <div className="font-mono text-[13px] text-slate-100">{u.user}</div>
                        <div className="text-[11px] text-slate-500">{u.role}</div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5"><span className="flex items-center gap-1.5"><PctBadge pct={u.percentile} level={u.level} /><Trend now={u.percentile} before={u.previous_percentile} /></span></td>
                      <td className="px-3 py-2.5">{u.level !== 'Normal' && <LevelBadge level={u.level} />}</td>
                      <td className="px-3 py-2.5">{u.stage > 0 && <StageBadge stage={u.stage} />}</td>
                      <td className="max-w-56 truncate px-3 py-2.5 text-xs text-slate-400" title={u.reasons[0]?.reason}>{u.reasons[0]?.reason ?? '—'}</td>
                      {evalMode && <td className="px-3 py-2.5">{truth && <TruthBadge attacker={truth.attacker} />}</td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="xl:col-span-2">
          {current && (
            <Card title={<span className="flex items-center gap-2"><span className="font-mono">{current.user}</span><LevelBadge level={current.level} /></span>}
              subtitle={`${current.role ?? 'Employee'} · ${current.events} events today`}
              right={<PctBadge pct={current.percentile} level={current.level} />}>
              <div>
                <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-slate-500">Why</div>
                {current.reasons.length ? <Reasons reasons={current.reasons} /> : <p className="text-sm text-slate-400">Behaviour so far matches this employee's normal pattern.</p>}
              </div>
              <div className="mt-5 border-t border-white/5 pt-4">
                <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-slate-500">Attack stages, last 30 days</div>
                <StageTrack firsts={current.stage_first} current={current.stage} compact />
              </div>
              <div className="mt-5 flex items-center justify-between border-t border-white/5 pt-4">
                {evalMode && data.truth?.[current.user] ? (
                  <TruthBadge attacker={data.truth[current.user].attacker}
                    label={data.truth[current.user].attacker ? `Attacker · replay of ${data.truth[current.user].replayed_insider}` : 'Normal employee'} />
                ) : <span />}
                <Button size="sm" tone="primary" onClick={() => onExplore(current.user)}><Compass className="h-3.5 w-3.5" />Explore</Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function PeriodView({ range, evalMode, onExplore }: { range: Extract<TimeRange, { kind: 'period' }>; evalMode: boolean; onExplore: (u: string) => void }) {
  const [data, setData] = useState<HistoryData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    setData(null)
    api.history(range.start, range.end, evalMode, ctrl.signal).then((d) => { setData(d); setError(null) })
      .catch((e) => e.name !== 'AbortError' && setError(String(e.message)))
    return () => ctrl.abort()
  }, [range.start, range.end, evalMode])

  if (error) return <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-200">{error}</div>
  if (!data) return <Empty>Loading…</Empty>
  const k = data.kpis
  const busiest = data.series.reduce<HistoryData['series'][number] | null>((best, d) => (!best || d.alerts > best.alerts ? d : best), null)

  return (
    <div className="space-y-6">
      <StatusHeader
        eyebrow="Historical analysis"
        title={range.label}
        subtitle={<>{fmtDay(data.start)} → {fmtDay(data.end)}{data.includes_replay_day ? ' · includes today\'s live data' : ''}</>}
        level={threatLevel(k.high_alerts, k.alerts - k.high_alerts, data.top_users.filter((u) => u.peak_level === 'Watch').length)}
        message={busiest && busiest.alerts ? `Busiest day: ${fmtDay(busiest.day)} (${plural(busiest.alerts, 'alert')})` : 'No alerts in this range'}
        action={data.top_users[0] ? <Button tone="primary" onClick={() => onExplore(data.top_users[0].user)}><Compass className="h-4 w-4" />Explore {data.top_users[0].user}</Button> : undefined}
        stats={[
          { label: 'Employee-days', value: k.user_days.toLocaleString(), hint: `${k.users} employees` },
          { label: 'Alerts', value: k.alerts.toLocaleString(), hint: 'Medium or High', tone: k.alerts ? 'warn' : 'ok' },
          { label: 'High alerts', value: k.high_alerts.toLocaleString(), hint: 'top 0.2%', tone: k.high_alerts ? 'danger' : 'ok' },
          { label: 'Employees alerted', value: k.users_alerted, hint: 'one alert or more', tone: 'info' },
          { label: 'Staging or beyond', value: k.users_staging_plus, hint: 'attack stage 3+', tone: k.users_staging_plus ? 'danger' : 'ok' },
        ]}
      />

      {evalMode && data.truth && (
        <Card title="Ground truth" subtitle="Shield's results compared with the CERT answer key" right={<EvalNote>Evaluation only, not available in real use</EvalNote>} pad={false}>
          <div className="grid sm:grid-cols-3">
            {[
              ['Attack days alerted', data.truth.attack_days_alerted, data.truth.attack_days, 'real attack days that got a Medium or High alert'],
              ['Attackers alerted', data.truth.attackers_alerted, data.truth.attackers, 'accounts with attack activity in this range'],
              ['Alerts that were real attacks', data.truth.real_alerts, data.truth.alerts, 'the rest are false alarms'],
            ].map(([label, n, of, hint], i) => (
              <div key={String(label)} className={cx('px-5 py-3', i > 0 && 'sm:border-l sm:border-white/5')}>
                <div className="text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
                <div className="font-display mt-1 text-2xl font-semibold tabular-nums text-slate-100">{n} <span className="text-sm font-normal text-slate-500">of {of}</span></div>
                <div className="text-xs text-slate-500">{hint}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Alerts per day">
          <div className="h-60">
            <ResponsiveContainer>
              <BarChart data={data.series} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="day" tickFormatter={(d: string) => (data.series.length > 120 ? d.slice(0, 7) : d.slice(5))} minTickGap={40} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={TOOLTIP} cursor={{ fill: 'rgba(148,163,184,0.06)' }} labelFormatter={(d) => fmtDay(String(d))} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
                <Bar dataKey="high" name="High" stackId="a" fill="#f43f5e" isAnimationActive={false} />
                <Bar dataKey={(r: { alerts: number; high: number }) => r.alerts - r.high} name="Medium" stackId="a" fill="#f59e0b" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Highest attack stage" subtitle="Employees by the furthest stage reached">
          <StageDistribution counts={data.stage_counts} note={`${data.stage_counts.Normal} employees showed no attack evidence.`} />
        </Card>
      </div>

      <Card title="Alert calendar">
        <CalendarHeatmap series={data.series} />
      </Card>

      <Card title="Riskiest employees" right={<span className="text-xs text-slate-500">{data.top_users.length} employees</span>} pad={false}>
        {data.top_users.length === 0 ? <Empty>No risky employees in this time range.</Empty> : (
          <div className="max-h-[34rem] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-ink-900">
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-2.5 font-medium">Employee</th>
                  <th className="px-3 py-2.5 font-medium">Peak risk</th>
                  <th className="px-3 py-2.5 font-medium">Alert days</th>
                  <th className="px-3 py-2.5 font-medium">Highest stage</th>
                  <th className="px-3 py-2.5 font-medium">Last alert</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.top_users.map((u) => (
                  <tr key={u.user} onClick={() => onExplore(u.user)} className="cursor-pointer hover:bg-white/[0.02]">
                    <td className="px-5 py-2.5">
                      <div className="font-mono text-[13px] text-cyan-300">{u.user}</div>
                      <div className="text-[11px] text-slate-500">{u.role}</div>
                      {evalMode && u.insider !== undefined && <div className="mt-1"><TruthBadge attacker={u.insider} label={u.insider ? 'Real insider' : 'Not an insider'} /></div>}
                    </td>
                    <td className="px-3 py-2.5"><PctBadge pct={u.peak_pct} level={u.peak_level} /></td>
                    <td className="px-3 py-2.5 tabular-nums text-slate-300">{u.alert_days} <span className="text-slate-600">/ {u.active_days}</span></td>
                    <td className="px-3 py-2.5">{u.max_stage > 0 ? <StageBadge stage={u.max_stage} /> : <span className="text-slate-600">—</span>}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-400">{u.last_alert ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Recent alerts" right={<span className="text-xs text-slate-500">latest {data.alerts.length}</span>} pad={false}>
        {data.alerts.length === 0 ? <Empty>No alerts in this time range.</Empty> : (
          <ol className="max-h-[30rem] divide-y divide-white/5 overflow-y-auto">
            {data.alerts.map((a) => (
              <li key={`${a.user}-${a.day}`} className="flex gap-4 px-5 py-3">
                <div className="w-32 shrink-0">
                  <div className="font-mono text-xs text-slate-300">{a.day}</div>
                  <button type="button" onClick={() => onExplore(a.user)} className="font-mono text-[13px] text-cyan-300 hover:underline">{a.user}</button>
                  <div className="text-[11px] text-slate-500">{a.role}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><LevelBadge level={a.level} /><PctBadge pct={a.pct} level={a.level} />
                    {evalMode && a.truth !== undefined && a.truth !== null && <TruthBadge attacker={a.truth} label={a.truth ? 'Real attack day' : 'False alarm'} />}
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-300">{a.story.split(': ').slice(1).join(': ') || a.story}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  )
}

export default function DashboardsPage({ meta, range, evalMode, onExplore, onDataSources }: {
  meta: Meta
  range: TimeRange
  evalMode: boolean
  onExplore: (u: string) => void
  onDataSources: () => void
}) {
  return (
    <div className="space-y-6">
      <WelcomeBanner users={meta.users} day={meta.replay_day} />
      {range.kind === 'live'
        ? <LiveView meta={meta} evalMode={evalMode} onExplore={onExplore} onDataSources={onDataSources} />
        : <PeriodView range={range} evalMode={evalMode} onExplore={onExplore} />}
    </div>
  )
}
