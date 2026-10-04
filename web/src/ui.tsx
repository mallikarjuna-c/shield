import type { ReactNode } from 'react'

export const STAGE_NAMES = ['Normal', 'Reconnaissance', 'Collection', 'Staging', 'Exfiltration', 'Departure']

export const STAGE_STYLE: Record<number, { text: string; bg: string; ring: string; dot: string }> = {
  0: { text: 'text-slate-400', bg: 'bg-slate-500/10', ring: 'ring-slate-500/20', dot: 'bg-slate-500' },
  1: { text: 'text-sky-300', bg: 'bg-sky-500/10', ring: 'ring-sky-500/25', dot: 'bg-sky-400' },
  2: { text: 'text-violet-300', bg: 'bg-violet-500/10', ring: 'ring-violet-500/25', dot: 'bg-violet-400' },
  3: { text: 'text-amber-300', bg: 'bg-amber-500/10', ring: 'ring-amber-500/25', dot: 'bg-amber-400' },
  4: { text: 'text-rose-300', bg: 'bg-rose-500/10', ring: 'ring-rose-500/25', dot: 'bg-rose-500' },
  5: { text: 'text-fuchsia-300', bg: 'bg-fuchsia-500/10', ring: 'ring-fuchsia-500/25', dot: 'bg-fuchsia-400' },
}

export const TOOLTIP = { background: '#0f172a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontSize: 12 }

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ')
}

export function Card({ title, subtitle, right, children, className, pad = true }: {
  title?: ReactNode
  subtitle?: ReactNode
  right?: ReactNode
  children: ReactNode
  className?: string
  pad?: boolean
}) {
  return (
    <section className={cx('rounded-xl border border-cyan-400/10 bg-ink-900/70 shadow-[0_8px_30px_-14px_rgba(34,211,238,0.18)] backdrop-blur', className)}>
      {(title || right) && (
        <header className="flex items-start justify-between gap-4 border-b border-cyan-400/10 px-5 py-3.5">
          <div>
            <h2 className="text-[13px] font-semibold tracking-wide text-slate-200">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      <div className={pad ? 'p-5' : ''}>{children}</div>
    </section>
  )
}

export const LEVEL_STYLE: Record<string, string> = {
  High: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
  Medium: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  Watch: 'bg-sky-500/10 text-sky-300 ring-sky-500/25',
  Normal: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/20',
}

export function LevelBadge({ level }: { level: string }) {
  return <span className={cx('rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset', LEVEL_STYLE[level] ?? LEVEL_STYLE.Normal)}>{level}</span>
}

export function PctBadge({ pct, level }: { pct: number; level: string }) {
  return (
    <span className={cx('inline-flex justify-center rounded-md px-1.5 py-0.5 font-mono text-xs ring-1 ring-inset', LEVEL_STYLE[level] ?? LEVEL_STYLE.Normal)}
      title={`Riskier than ${pct.toFixed(2)}% of all employee-days in 2010–2011`}>
      {pct >= 99.95 ? '>99.9' : pct.toFixed(1)}
    </span>
  )
}

export function StageBadge({ stage }: { stage: number }) {
  const s = STAGE_STYLE[stage]
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset', s.bg, s.text, s.ring)}>
      <span className={cx('h-1.5 w-1.5 rounded-full', s.dot)} />
      {STAGE_NAMES[stage]}
    </span>
  )
}

export function TruthBadge({ attacker, label }: { attacker: boolean; label?: string }) {
  return (
    <span className={cx('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
      attacker ? 'bg-rose-500/15 text-rose-200 ring-rose-500/40' : 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/25')}>
      {label ?? (attacker ? 'Attacker' : 'Normal')}
    </span>
  )
}

export function ThresholdLegend() {
  return (
    <div className="flex gap-3 text-[11px] text-slate-500">
      {([['Watch', '#38bdf8'], ['Medium', '#f59e0b'], ['High', '#f43f5e']] as const).map(([l, c]) => (
        <span key={l} className="flex items-center gap-1.5"><span className="w-3 border-t border-dashed" style={{ borderColor: c }} />{l}</span>
      ))}
    </div>
  )
}

export function StageTrack({ firsts, current, compact = false }: { firsts: Record<string, string | null>; current: number; compact?: boolean }) {
  if (compact) {
    return (
      <ol className="space-y-1">
        {STAGE_NAMES.slice(1).map((name, i) => {
          const stage = i + 1
          const date = firsts[name]
          const s = STAGE_STYLE[stage]
          return (
            <li key={name} className="flex items-center gap-2.5 text-xs">
              <span className={cx('flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-semibold', date ? cx(s.dot, 'text-ink-950') : 'bg-white/5 text-slate-500')}>{stage}</span>
              <span className={cx('flex-1', date ? s.text : 'text-slate-500')}>{name}{current === stage && <span className="ml-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />}</span>
              <span className={cx('font-mono text-[11px]', date ? 'text-slate-300' : 'text-slate-600')}>{date ?? '—'}</span>
            </li>
          )
        })}
      </ol>
    )
  }
  return (
    <ol className="grid grid-cols-5 gap-2">
      {STAGE_NAMES.slice(1).map((name, i) => {
        const stage = i + 1
        const date = firsts[name]
        const s = STAGE_STYLE[stage]
        const reached = Boolean(date)
        return (
          <li key={name} className={cx('rounded-lg border px-2.5 py-2', reached ? cx('border-transparent ring-1 ring-inset', s.bg, s.ring) : 'border-dashed border-white/10')}>
            <div className="flex items-center gap-1.5">
              <span className={cx('flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-semibold', reached ? cx(s.dot, 'text-ink-950') : 'bg-white/5 text-slate-500')}>{stage}</span>
              <span className={cx('truncate text-[11px] font-medium', reached ? s.text : 'text-slate-500')}>{name}</span>
              {current === stage && <span className="ml-auto h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />}
            </div>
            <div className={cx('mt-1 font-mono text-[10px]', reached ? 'text-slate-300' : 'text-slate-600')}>{date ?? '—'}</div>
          </li>
        )
      })}
    </ol>
  )
}

export function Reasons({ reasons }: { reasons: { reason: string; weight: number }[] }) {
  if (!reasons.length) return <p className="text-sm text-slate-500">No single dominant signal.</p>
  const max = Math.max(...reasons.map((x) => x.weight), 1)
  return (
    <ul className="space-y-2">
      {reasons.map((r) => (
        <li key={r.reason} className="grid grid-cols-[1fr_130px] items-center gap-3 text-sm">
          <span className="text-slate-300">{r.reason}</span>
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 rounded-full bg-white/5"><div className="h-1.5 rounded-full bg-rose-400/80" style={{ width: `${(r.weight / max) * 100}%` }} /></div>
            <span className="w-8 text-right font-mono text-[10px] text-slate-500">+{r.weight.toFixed(1)}</span>
          </div>
        </li>
      ))}
    </ul>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-10 text-center text-sm text-slate-500">{children}</div>
}

export function Button({ children, onClick, tone = 'default', disabled, size = 'md' }: {
  children: ReactNode
  onClick?: () => void
  tone?: 'default' | 'primary' | 'danger' | 'ghost'
  disabled?: boolean
  size?: 'sm' | 'md'
}) {
  const tones = {
    default: 'bg-white/5 text-slate-200 hover:bg-white/10 ring-white/10',
    primary: 'bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25 ring-cyan-500/30',
    danger: 'bg-rose-500/15 text-rose-200 hover:bg-rose-500/25 ring-rose-500/30',
    ghost: 'text-slate-400 hover:text-slate-200 hover:bg-white/5 ring-transparent',
  }
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      className={cx('inline-flex items-center gap-1.5 rounded-lg font-medium ring-1 ring-inset transition disabled:cursor-not-allowed disabled:opacity-40',
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm', tones[tone])}>
      {children}
    </button>
  )
}

export function fmtDay(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
}

export function storyBody(story: string) {
  return story.split(': ').slice(1).join(': ')
}
