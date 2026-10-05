import { useCallback, useEffect, useState } from 'react'
import { Activity, ChevronRight, Compass, Database, Eye, EyeOff, LayoutGrid, PanelLeftClose, PanelLeftOpen, RefreshCw } from 'lucide-react'
import { api, type Meta, type Realtime } from './api'
import { cx } from './ui'
import { Logo, LogoMark } from './Logo'
import TimePicker, { LIVE, type TimeRange } from './TimePicker'
import DashboardsPage from './pages/Dashboards'
import ExplorePage from './pages/Explore'
import DataSourcesPage from './pages/DataSources'
import ServerOffline from './ServerOffline'

type Page = 'dashboards' | 'explore' | 'datasources'

const NAV: [Page, string, typeof LayoutGrid][] = [
  ['dashboards', 'Dashboards', LayoutGrid],
  ['explore', 'Explore', Compass],
  ['datasources', 'Data sources', Database],
]

const TITLES: Record<Page, string> = {
  dashboards: 'Insider threat overview',
  explore: 'Employee investigation',
  datasources: 'Activity log uploads',
}

const COLLAPSE_KEY = 'shield.sidebar.collapsed'

function pageFromHash(): Page {
  const h = window.location.hash.slice(1)
  return NAV.some(([id]) => id === h) ? (h as Page) : 'dashboards'
}

function initialCollapsed() {
  try {
    const saved = localStorage.getItem(COLLAPSE_KEY)
    if (saved !== null) return saved === '1'
  } catch { /* storage unavailable */ }
  return window.innerWidth < 1024
}

interface Badge {
  text: string
  tone: 'danger' | 'warn' | 'info' | 'muted'
}

const BADGE_TONE = {
  danger: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
  warn: 'bg-amber-500/15 text-amber-200 ring-amber-500/30',
  info: 'bg-cyan-500/10 text-cyan-200 ring-cyan-400/25',
  muted: 'bg-white/5 text-slate-400 ring-white/10',
}

const DOT_TONE = { danger: 'bg-rose-400', warn: 'bg-amber-300', info: 'bg-cyan-300', muted: '' }

function badges(live: Realtime | null, meta: Meta | null, focus: string | null): Partial<Record<Page, Badge>> {
  const out: Partial<Record<Page, Badge>> = {}
  const s = live?.latest?.summary
  if (s && s.high + s.medium) out.dashboards = { text: String(s.high + s.medium), tone: s.high ? 'danger' : 'warn' }
  if (focus) out.explore = { text: focus, tone: 'info' }
  if (meta) {
    const done = live?.timeline.length ?? 0
    out.datasources = { text: `${done}/${meta.slots.length}`, tone: done === meta.slots.length ? 'info' : 'muted' }
  }
  return out
}

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null)
  const [live, setLive] = useState<Realtime | null>(null)
  const [page, setPageState] = useState<Page>(pageFromHash)
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [range, setRange] = useState<TimeRange>(LIVE)
  const [evalMode, setEvalMode] = useState(false)
  const [focus, setFocus] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [offline, setOffline] = useState(false)
  const [checking, setChecking] = useState(false)

  const connect = useCallback(() => {
    setChecking(true)
    api.meta()
      .then((m) => {
        setMeta(m)
        setOffline((was) => {
          if (was) setVersion((v) => v + 1)
          return false
        })
      })
      .catch(() => setOffline(true))
      .finally(() => setChecking(false))
  }, [])

  useEffect(() => { connect() }, [connect])

  useEffect(() => {
    if (!offline) return
    const id = setInterval(connect, 5000)
    return () => clearInterval(id)
  }, [offline, connect])

  useEffect(() => {
    if (offline) return
    const id = setInterval(() => api.meta().catch(() => setOffline(true)), 15000)
    return () => clearInterval(id)
  }, [offline])

  useEffect(() => {
    api.realtime(false).then(setLive).catch((e) => {
      setLive(null)
      if (e instanceof TypeError) setOffline(true)
    })
  }, [version, page])

  useEffect(() => {
    const sync = () => setPageState(pageFromHash())
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  const setPage = (next: Page) => {
    setPageState(next)
    if (window.location.hash.slice(1) !== next) window.location.hash = next
  }

  const toggle = () => {
    const next = !collapsed
    setCollapsed(next)
    try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0') } catch { /* storage unavailable */ }
  }

  const explore = (user: string) => {
    setFocus(user)
    setPage('explore')
  }

  const marks = offline ? {} : badges(live, meta, focus)
  const latest = live?.latest
  const uploads = live?.timeline.length ?? 0
  const complete = !!meta && uploads === meta.slots.length

  return (
    <div className="relative flex h-full">
      <div className="cyber-grid pointer-events-none fixed inset-0 opacity-30 [mask-image:radial-gradient(ellipse_at_top_right,black_10%,transparent_60%)]" />

      <aside className={cx('relative z-10 flex shrink-0 flex-col border-r border-white/[0.07] bg-ink-900 transition-[width] duration-200', collapsed ? 'w-16' : 'w-60')}>
        <a href="/" title="Shield home" className={cx('flex h-16 shrink-0 items-center border-b border-white/[0.07]', collapsed ? 'justify-center' : 'px-5')}>
          {collapsed ? <LogoMark size={28} /> : <Logo size={30} />}
        </a>

        <nav className={cx('flex-1 py-4', collapsed ? 'px-2' : 'px-3')}>
          {!collapsed && <div className="mb-2 px-3 text-[11px] font-medium uppercase tracking-wider text-slate-500">Menu</div>}
          <ul className="space-y-0.5">
            {NAV.map(([id, label, Icon]) => {
              const badge = marks[id]
              const active = page === id
              return (
                <li key={id}>
                  <button type="button" onClick={() => setPage(id)} aria-current={active ? 'page' : undefined}
                    title={collapsed ? `${label}${badge ? ` · ${badge.text}` : ''}` : undefined}
                    className={cx('relative flex h-9 w-full items-center gap-3 rounded-md text-[13px] transition-colors',
                      collapsed ? 'justify-center' : 'px-3',
                      active ? 'bg-white/[0.06] font-medium text-white' : 'text-slate-400 hover:bg-white/[0.03] hover:text-slate-200')}>
                    {active && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-cyan-400" />}
                    <Icon className={cx('h-4 w-4 shrink-0', active ? 'text-cyan-300' : 'text-slate-500')} />
                    {!collapsed && <span className="flex-1 truncate text-left">{label}</span>}
                    {badge && !collapsed && (
                      <span className={cx('max-w-20 truncate rounded px-1.5 py-px font-mono text-[10px] ring-1 ring-inset', BADGE_TONE[badge.tone])}>{badge.text}</span>
                    )}
                    {badge && collapsed && badge.tone !== 'muted' && <span className={cx('absolute right-2.5 top-1.5 h-1.5 w-1.5 rounded-full', DOT_TONE[badge.tone])} />}
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className={cx('shrink-0 border-t border-white/[0.07] text-[11px] text-slate-500', collapsed ? 'flex justify-center py-4' : 'px-5 py-4')}>
          {collapsed ? (
            <span title="LightGBM · CERT r4.2"><Activity className="h-4 w-4 text-emerald-400" /></span>
          ) : (
            <>
              <div className="flex items-center gap-2 text-slate-400"><Activity className="h-3.5 w-3.5 text-emerald-400" />LightGBM · CERT r4.2</div>
              {meta && <div className="mt-1 font-mono">{meta.history_first} → {meta.replay_day}</div>}
            </>
          )}
        </div>
      </aside>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <header className="relative z-40 flex h-16 shrink-0 items-center justify-between gap-4 border-b border-white/[0.07] bg-ink-900/90 px-4 backdrop-blur">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={toggle} title={collapsed ? 'Expand menu' : 'Collapse menu'}
              className="grid h-9 w-9 place-items-center rounded-md text-slate-400 hover:bg-white/5 hover:text-slate-200">
              {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
            <span className="h-5 w-px bg-white/10" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <span>Shield</span>
                <ChevronRight className="h-3 w-3" />
                <span>{NAV.find(([id]) => id === page)?.[1]}</span>
              </div>
              <div className="truncate text-sm font-semibold text-slate-100">{TITLES[page]}</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {offline && (
              <div className="flex h-9 items-center gap-2 rounded-md px-3 text-xs text-amber-200 ring-1 ring-inset ring-amber-500/25">
                <span className="h-2 w-2 rounded-full bg-amber-400" />Offline
              </div>
            )}
            {meta && !offline && (
              <div title={latest ? `Data up to ${latest.as_of}` : 'No uploads yet'}
                className="hidden h-9 items-center gap-2.5 rounded-md px-3 text-xs text-slate-400 ring-1 ring-inset ring-white/10 xl:flex">
                <span className={cx('h-2 w-2 rounded-full', !latest ? 'bg-slate-600' : complete ? 'bg-cyan-400' : 'animate-pulse bg-emerald-400')} />
                <span className="text-slate-300">{!latest ? 'Waiting for uploads' : complete ? 'Day complete' : 'Live'}</span>
                <span className="flex gap-0.5">
                  {meta.slots.map((slot, i) => (
                    <span key={slot} title={slot} className={cx('h-1.5 w-3 rounded-sm', i < uploads ? 'bg-cyan-400' : 'bg-white/10')} />
                  ))}
                </span>
                {latest && <span className="font-mono text-slate-500">{latest.as_of}</span>}
              </div>
            )}
            <span className="mx-1 hidden h-5 w-px bg-white/10 xl:block" />
            <button type="button" onClick={() => setEvalMode((v) => !v)} title="Compare Shield with the CERT answer key"
              className={cx('flex h-9 items-center gap-1.5 rounded-md px-3 text-xs ring-1 ring-inset transition-colors',
                evalMode ? 'bg-amber-500/10 text-amber-200 ring-amber-500/25' : 'text-slate-400 ring-white/10 hover:bg-white/5 hover:text-slate-200')}>
              {evalMode ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}Evaluation
            </button>
            {meta && page !== 'datasources' && <TimePicker value={range} onChange={setRange} first={meta.history_first} last={meta.replay_day} />}
            <button type="button" title="Refresh" onClick={() => setVersion((v) => v + 1)}
              className="grid h-9 w-9 place-items-center rounded-md text-slate-400 ring-1 ring-inset ring-white/10 hover:bg-white/5 hover:text-slate-200">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          {offline && <ServerOffline checking={checking} onRetry={connect} />}
          {!offline && meta && page === 'dashboards' && <DashboardsPage key={version} meta={meta} range={range} evalMode={evalMode} onExplore={explore} onDataSources={() => setPage('datasources')} />}
          {!offline && meta && page === 'explore' && <ExplorePage key={version} meta={meta} range={range} evalMode={evalMode} user={focus} onUser={setFocus} />}
          {!offline && meta && page === 'datasources' && <DataSourcesPage meta={meta} onChanged={() => setVersion((v) => v + 1)} onDashboards={() => { setRange(LIVE); setPage('dashboards') }} />}
        </main>
      </div>
    </div>
  )
}
