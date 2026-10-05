import { useEffect, useState } from 'react'
import {
  Activity, ArrowRight, BrainCircuit, Database, Eye, FileSearch, Fingerprint, Gauge, LayoutGrid, Menu, Radar, Sparkles, UserX, Workflow, X,
} from 'lucide-react'
import { api, type HistoryData } from './api'
import { Logo } from './Logo'
import { LevelBadge, PctBadge, STAGE_NAMES, STAGE_STYLE, cx, fmtDay, storyBody } from './ui'

interface Summary {
  employees: number
  employee_days: number
  insiders: number
  insiders_in_top_100: number
  precision_at_100: number
  pr_auc: number
  random_pr_auc: number
  roc_auc: number
  future_high_precision: number
  future_medium_recall: number
  history_first: string
  history_last: string
}

const FEATURES = [
  { icon: Fingerprint, title: 'Personal baselines', text: "Every employee is compared with their own last 30 days, so a habit is never mistaken for a threat." },
  { icon: BrainCircuit, title: 'Gradient-boosted model', text: 'LightGBM scores every employee-day from 133 behavioural features: USB, files, web, email, logons.' },
  { icon: Sparkles, title: 'Explainable alerts', text: 'Each alert says why in plain English, built from the SHAP contribution of every signal.' },
  { icon: Radar, title: 'Attack-stage tracking', text: 'Follows an insider from reconnaissance to exfiltration and departure, usually while the attack is still unfolding.' },
  { icon: Gauge, title: 'Alert budgets', text: 'High, Medium and Watch are set from history (riskiest 0.2%, 1%, 2%), so analysts get a workload they can handle.' },
  { icon: Eye, title: 'Honest evaluation', text: 'Scores come from models that never saw the employee or the attack; shortcut features in the data were removed.' },
]

const STEPS = [
  { icon: Database, title: 'Collect', text: 'Logon, USB, file, email and web logs arrive through Data sources.' },
  { icon: Activity, title: 'Baseline', text: "Each day is compared with the person's own history and with colleagues in the same role." },
  { icon: Gauge, title: 'Score', text: 'The model ranks every employee-day against all past behaviour.' },
  { icon: FileSearch, title: 'Explain', text: 'Signals that raised the risk become a short, readable story.' },
  { icon: Workflow, title: 'Track', text: 'Evidence is mapped to attack stages so analysts see how far an attack has gone.' },
]

const SECTIONS = [['#features', 'Features'], ['#how', 'How it works'], ['#stages', 'Attack stages'], ['#results', 'Results']]

const STAGE_TEXT = [
  'Job-search or hacking sites far above normal',
  'Copying more files than usual, after-hours or other-PC logons',
  'USB use far above normal or for the first time, archives copied',
  'Leak or upload sites, attachments sent outside',
  'Leaves the company after earlier warning signs',
]

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="px-6 py-5 text-center">
      <div className="font-display glow-text text-3xl font-bold tabular-nums sm:text-4xl">{value}</div>
      <div className="mt-1 text-xs uppercase tracking-wider text-slate-400">{label}</div>
    </div>
  )
}

export default function Landing() {
  const [s, setS] = useState<Summary | null>(null)
  const [alert, setAlert] = useState<HistoryData['alerts'][number] | null>(null)
  const [menu, setMenu] = useState(false)

  useEffect(() => {
    fetch('/api/summary').then((r) => r.json()).then(setS).catch(() => {})
    api.history('2011-04-18', '2011-05-17', false).then((h) => setAlert(h.alerts.find((a) => a.level === 'High') ?? h.alerts[0] ?? null)).catch(() => {})
  }, [])

  const pct = (v: number) => `${Math.round(v * 100)}%`

  return (
    <div className="h-full overflow-y-auto scroll-smooth">
      <div className="cyber-grid pointer-events-none fixed inset-0 opacity-60 [mask-image:radial-gradient(ellipse_at_top,black_20%,transparent_70%)]" />

      <div className="sticky top-0 z-20 border-b border-cyan-400/10 bg-ink-950/75 backdrop-blur-md">
        <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <a href="/" aria-label="Shield home"><Logo /></a>
          <div className="hidden items-center gap-8 text-sm text-slate-400 md:flex">
            {SECTIONS.map(([href, label]) => <a key={href} href={href} className="hover:text-cyan-200">{label}</a>)}
          </div>
          <div className="flex items-center gap-2">
            <a href="/app" className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 hover:brightness-110">
              <LayoutGrid className="h-4 w-4" /><span className="hidden sm:inline">Open dashboard</span><span className="sm:hidden">Dashboard</span>
            </a>
            <button type="button" onClick={() => setMenu((v) => !v)} aria-label={menu ? 'Close menu' : 'Open menu'} aria-expanded={menu}
              className="grid h-9 w-9 place-items-center rounded-lg text-slate-300 ring-1 ring-inset ring-white/10 hover:bg-white/5 md:hidden">
              {menu ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </nav>
        {menu && (
          <div className="border-t border-cyan-400/10 px-6 py-3 md:hidden">
            {SECTIONS.map(([href, label]) => (
              <a key={href} href={href} onClick={() => setMenu(false)} className="block rounded-md px-2 py-2.5 text-sm text-slate-300 hover:bg-white/5 hover:text-cyan-200">{label}</a>
            ))}
          </div>
        )}
      </div>

      <header className="relative z-10 mx-auto grid max-w-7xl items-center gap-12 px-6 pb-20 pt-12 lg:grid-cols-2 lg:pt-20">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300" />Insider threat detection · machine learning · explainable
          </span>
          <h1 className="mt-6 text-4xl font-bold leading-tight text-slate-50 sm:text-5xl lg:text-6xl">
            Catch insider threats <span className="glow-text">while the attack is still unfolding.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-400">
            Shield learns how every employee normally works and flags the days that break the pattern: night logons, first-ever USB copies,
            job hunting, leak sites. Every alert explains itself.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="/app" className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-3 font-semibold text-white shadow-lg shadow-cyan-500/25 hover:brightness-110">
              Open dashboard<ArrowRight className="h-4 w-4" />
            </a>
            <a href="#how" className="rounded-lg border border-white/10 px-5 py-3 font-semibold text-slate-200 hover:border-cyan-400/40 hover:bg-white/5">How it works</a>
          </div>
        </div>

        <div className="relative">
          <div className="absolute -inset-6 rounded-3xl bg-gradient-to-br from-cyan-500/20 via-blue-600/10 to-transparent blur-2xl" />
          <div className="glow-ring relative overflow-hidden rounded-2xl border border-cyan-400/20 bg-ink-900/90 p-6 backdrop-blur">
            <div className="scan-line pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-transparent via-cyan-400/10 to-transparent" />
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs uppercase tracking-wider text-slate-400"><span className="h-2 w-2 animate-pulse rounded-full bg-rose-400" />{alert && alert.level !== 'High' ? 'Latest alert' : 'Latest high-risk alert'}</span>
              {alert && <span className="font-mono text-xs text-slate-500">{alert.day}</span>}
            </div>
            {alert ? (
              <>
                <div className="mt-5 flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-rose-500/15 ring-1 ring-rose-500/30"><UserX className="h-5 w-5 text-rose-300" /></div>
                  <div>
                    <div className="font-mono text-lg text-slate-100">{alert.user}</div>
                    <div className="text-xs text-slate-500">{alert.role}</div>
                  </div>
                  <div className="ml-auto flex items-center gap-2"><LevelBadge level={alert.level} /><PctBadge pct={alert.pct} level={alert.level} /></div>
                </div>
                <p className="mt-5 rounded-lg border border-white/5 bg-ink-950/70 p-4 text-sm leading-relaxed text-slate-300">{storyBody(alert.story)}</p>
                <p className="mt-3 text-[11px] text-slate-600">A real alert from the evaluation data, scored by a model that never saw this employee.</p>
              </>
            ) : (
              <div className="mt-5 animate-pulse space-y-4" aria-hidden="true">
                <div className="flex items-center gap-3">
                  <div className="h-11 w-11 rounded-full bg-white/5" />
                  <div className="space-y-2"><div className="h-4 w-24 rounded bg-white/5" /><div className="h-3 w-32 rounded bg-white/5" /></div>
                </div>
                <div className="h-24 rounded-lg bg-white/5" />
              </div>
            )}
          </div>
        </div>
      </header>

      <section id="results" className="relative z-10 scroll-mt-20 border-y border-cyan-400/10 bg-ink-900/50">
        <div className="mx-auto grid max-w-7xl grid-cols-2 divide-x divide-cyan-400/10 md:grid-cols-5">
          <Stat value={s ? s.employees.toLocaleString() : '…'} label="employees monitored" />
          <Stat value={s ? s.employee_days.toLocaleString() : '…'} label="employee-days analysed" />
          <Stat value={s ? `${s.insiders_in_top_100}/${s.insiders}` : '…'} label="insiders in top 100 users" />
          <Stat value={s ? pct(s.precision_at_100) : '…'} label="top-100 alerts correct" />
          <Stat value={s ? pct(s.future_high_precision) : '…'} label="High alerts correct, future test" />
        </div>
      </section>

      <section id="features" className="relative z-10 scroll-mt-20 mx-auto max-w-7xl px-6 py-24">
        <p className="text-sm font-semibold uppercase tracking-widest text-cyan-300">Features</p>
        <h2 className="mt-3 max-w-2xl text-3xl font-bold text-slate-50 sm:text-4xl">Behaviour analytics built for one question: who is about to take what?</h2>
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="group rounded-xl border border-cyan-400/10 bg-ink-900/60 p-6 transition hover:border-cyan-400/30 hover:bg-ink-900/90">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-cyan-500/10 ring-1 ring-cyan-400/20 transition group-hover:bg-cyan-500/20"><Icon className="h-5 w-5 text-cyan-300" /></div>
              <h3 className="font-display mt-5 text-lg font-semibold text-slate-100">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="how" className="relative z-10 scroll-mt-20 border-y border-cyan-400/10 bg-ink-900/40">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <p className="text-sm font-semibold uppercase tracking-widest text-cyan-300">How it works</p>
          <h2 className="mt-3 text-3xl font-bold text-slate-50 sm:text-4xl">From raw logs to an explained alert</h2>
          <ol className="mt-12 grid gap-5 md:grid-cols-5">
            {STEPS.map(({ icon: Icon, title, text }, i) => (
              <li key={title} className="relative rounded-xl border border-cyan-400/10 bg-ink-950/60 p-5">
                <div className="flex items-center gap-3">
                  <span className="font-display text-sm font-bold text-cyan-300/60">0{i + 1}</span>
                  <Icon className="h-5 w-5 text-cyan-300" />
                </div>
                <h3 className="font-display mt-4 font-semibold text-slate-100">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{text}</p>
                {i < STEPS.length - 1 && <ArrowRight className="absolute -right-4 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-cyan-400/40 md:block" />}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="stages" className="relative z-10 scroll-mt-20 mx-auto max-w-7xl px-6 py-24">
        <p className="text-sm font-semibold uppercase tracking-widest text-cyan-300">Attack stages</p>
        <h2 className="mt-3 max-w-2xl text-3xl font-bold text-slate-50 sm:text-4xl">See how far an attack has gone, not just that something looks odd</h2>
        <div className="mt-12 grid gap-4 md:grid-cols-5">
          {STAGE_NAMES.slice(1).map((name, i) => {
            const st = STAGE_STYLE[i + 1]
            return (
              <div key={name} className={cx('rounded-xl p-5 ring-1 ring-inset', st.bg, st.ring)}>
                <div className="flex items-center gap-2">
                  <span className={cx('flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-ink-950', st.dot)}>{i + 1}</span>
                  <span className={cx('font-display font-semibold', st.text)}>{name}</span>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-slate-400">{STAGE_TEXT[i]}</p>
              </div>
            )
          })}
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-7xl px-6 pb-24">
        <div className="glow-ring relative overflow-hidden rounded-2xl border border-cyan-400/20 bg-gradient-to-br from-cyan-500/10 via-ink-900 to-blue-600/10 p-10 md:p-14">
          <div className="grid items-center gap-8 md:grid-cols-3">
            <div className="md:col-span-2">
              <h2 className="text-3xl font-bold text-slate-50">Watch a day unfold</h2>
              <p className="mt-3 text-slate-400">
                Upload a day of activity in five parts and watch Shield re-score 100 employees as each part arrives, including five real attacks
                the model has never seen.
              </p>
              {s && (
                <p className="mt-4 text-xs leading-relaxed text-slate-500">
                  Trained and evaluated on the CERT Insider Threat dataset r4.2 (Carnegie Mellon University, synthetic, {fmtDay(s.history_first)} to {fmtDay(s.history_last)}).
                  Cross-validated PR-AUC {s.pr_auc.toFixed(2)} against {s.random_pr_auc.toFixed(3)} for random ranking. Expect different numbers on real company data.
                </p>
              )}
            </div>
            <div className="flex md:justify-end">
              <a href="/app" className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-6 py-3.5 font-semibold text-white shadow-lg shadow-cyan-500/25 hover:brightness-110">
                Open dashboard<ArrowRight className="h-4 w-4" />
              </a>
            </div>
          </div>
        </div>
      </section>

      <footer className="relative z-10 border-t border-cyan-400/10 bg-ink-900/40">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 py-14 md:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <a href="/" aria-label="Shield home"><Logo /></a>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-400">
              Explainable insider-threat detection: behavioural baselines, a gradient-boosted model and attack-stage tracking.
            </p>
            <div className="mt-6 rounded-xl border border-cyan-400/10 bg-ink-950/60 p-4">
              <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Built by</div>
              <div className="font-display mt-1.5 text-base font-semibold text-slate-100">Mallikarjuna C</div>
              <div className="text-sm text-slate-400">AI Research Engineer</div>
              <a href="https://www.linkedin.com/in/mallikarjunac1006" target="_blank" rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[#0a66c2]/15 px-3 py-1.5 text-sm text-sky-200 ring-1 ring-inset ring-[#0a66c2]/40 hover:bg-[#0a66c2]/25">
                <span className="flex h-4 w-4 items-center justify-center rounded-[3px] bg-[#0a66c2] text-[9px] font-bold leading-none text-white">in</span>
                linkedin.com/in/mallikarjunac1006
              </a>
            </div>
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-200">Product</div>
            <ul className="mt-4 space-y-2.5 text-sm text-slate-400">
              {SECTIONS.map(([href, label]) => <li key={href}><a href={href} className="hover:text-cyan-200">{label}</a></li>)}
            </ul>
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-200">Dashboard</div>
            <ul className="mt-4 space-y-2.5 text-sm text-slate-400">
              <li><a href="/app#dashboards" className="hover:text-cyan-200">Dashboards</a></li>
              <li><a href="/app#explore" className="hover:text-cyan-200">Explore</a></li>
              <li><a href="/app#datasources" className="hover:text-cyan-200">Data sources</a></li>
            </ul>
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-200">About</div>
            <ul className="mt-4 space-y-2.5 text-sm text-slate-400">
              <li>Data: CERT Insider Threat dataset r4.2, Carnegie Mellon University (synthetic)</li>
              <li>Model: LightGBM with SHAP explanations</li>
              <li>Stack: Python, FastAPI, React</li>
            </ul>
          </div>
        </div>
        <div className="border-t border-cyan-400/10">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-5 text-xs text-slate-500">
            <span>© {new Date().getFullYear()} Shield · Mallikarjuna C</span>
            <span>Insider threat detection research project</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
