import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, Circle, FileUp, LayoutGrid, Loader2, RotateCcw, Upload } from 'lucide-react'
import { api, type Meta, type Realtime } from '../api'
import { Button, Card, fmtDay, cx } from '../ui'

const COLUMNS = ['source', 'id', 'date', 'user', 'pc', 'activity', 'filename', 'url', 'to', 'cc', 'bcc', 'from', 'size', 'attachments']

const LEVELS = [
  ['high', 'High', 'bg-rose-500/10 text-rose-300 ring-rose-500/25'],
  ['medium', 'Medium', 'bg-amber-500/10 text-amber-200 ring-amber-500/25'],
  ['watch', 'Watch', 'bg-cyan-500/10 text-cyan-200 ring-cyan-400/25'],
] as const

export default function DataSourcesPage({ meta, onChanged, onDashboards }: { meta: Meta; onChanged: () => void; onDashboards: () => void }) {
  const [data, setData] = useState<Realtime | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const load = useCallback(() => api.realtime(false).then(setData).catch((e) => setError(String(e.message))), [])
  useEffect(() => { load() }, [load])

  const send = async (list: FileList | File[]) => {
    setError(null)
    setMessage(null)
    for (const f of Array.from(list).sort((a, b) => a.name.localeCompare(b.name))) {
      setBusy(f.name)
      try {
        const r = await api.upload(f.name, await f.text())
        setMessage(`${f.name}: ${r.new_events.toLocaleString()} new events, data up to ${r.as_of}`)
        await load()
        onChanged()
      } catch (e) {
        setError(`${f.name}: ${(e as Error).message}`)
        break
      } finally {
        setBusy(null)
      }
    }
  }

  const reset = async () => {
    if (!confirm(`Remove all activity received for ${fmtDay(meta.replay_day)}?`)) return
    await api.reset()
    setError(null)
    setMessage('All uploads for the day were removed')
    await load()
    onChanged()
  }

  const received = data?.timeline ?? []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Data sources</h1>
          <p className="mt-1 text-sm text-slate-500">Activity logs for {fmtDay(meta.replay_day)}</p>
        </div>
        <div className="flex gap-2">
          <Button tone="ghost" onClick={reset} disabled={!received.length || Boolean(busy)}><RotateCcw className="h-4 w-4" />Reset day</Button>
          <Button tone="primary" onClick={onDashboards} disabled={!received.length}><LayoutGrid className="h-4 w-4" />View dashboard</Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); if (!busy) send(e.dataTransfer.files) }}
          className={cx('flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-10 text-center transition-colors xl:col-span-2',
            drag ? 'border-cyan-400/60 bg-cyan-500/5' : 'border-white/15 bg-ink-900/50')}>
          <div className="grid h-12 w-12 place-items-center rounded-full bg-cyan-500/10 ring-1 ring-inset ring-cyan-400/20">
            {busy ? <Loader2 className="h-5 w-5 animate-spin text-cyan-300" /> : <Upload className="h-5 w-5 text-cyan-300" />}
          </div>
          <p className="mt-4 text-sm font-medium text-slate-200">{busy ? `Processing ${busy}` : 'Drop CSV files here'}</p>
          <div className="mt-4"><Button tone="primary" onClick={() => input.current?.click()} disabled={Boolean(busy)}><FileUp className="h-4 w-4" />Choose files</Button></div>
          <input ref={input} type="file" accept=".csv" multiple className="hidden" onChange={(e) => { if (e.target.files) send(e.target.files); e.target.value = '' }} />
          {error && <div className="mt-6 w-full max-w-lg rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-200">{error}</div>}
          {!error && message && <div className="mt-6 w-full max-w-lg rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] px-4 py-2.5 text-sm text-emerald-200">{message}</div>}
        </div>

        <Card title="File format">
          <dl className="space-y-4 text-sm">
            <div>
              <dt className="text-xs text-slate-500">Type</dt>
              <dd className="mt-1 text-slate-300">CSV with a header row</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Date</dt>
              <dd className="mt-1 font-mono text-slate-300">MM/DD/YYYY HH:MM:SS</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Columns</dt>
              <dd className="mt-1.5 flex flex-wrap gap-1">
                {COLUMNS.map((c) => <code key={c} className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-slate-300">{c}</code>)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Rules</dt>
              <dd className="mt-1 text-slate-400">Events on {meta.replay_day} only; repeated event ids are skipped</dd>
            </div>
          </dl>
        </Card>
      </div>

      <Card title="Uploads" right={<span className="font-mono text-xs text-slate-500">{received.length}/{meta.slots.length} received</span>} pad={false}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5 text-left text-[11px] uppercase tracking-wider text-slate-500">
              <th className="px-5 py-2.5 font-medium">Time slot</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="px-3 py-2.5 font-medium">File</th>
              <th className="px-3 py-2.5 text-right font-medium">Events</th>
              <th className="px-5 py-2.5 font-medium">Alerts after upload</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {meta.slots.map((slot, i) => {
              const t = received[i]
              return (
                <tr key={slot} className={cx(!t && 'text-slate-500')}>
                  <td className="px-5 py-3 font-mono text-slate-300">{slot}</td>
                  <td className="px-3 py-3">{t
                    ? <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" />Received</span>
                    : <span className="inline-flex items-center gap-1.5 text-xs text-slate-500"><Circle className="h-3.5 w-3.5" />Pending</span>}</td>
                  <td className="px-3 py-3 font-mono text-xs text-slate-400">{t?.file ?? '—'}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-300">{t ? t.new_events.toLocaleString() : '—'}</td>
                  <td className="px-5 py-3">{t ? (
                    <span className="flex flex-wrap gap-1.5">
                      {LEVELS.map(([key, label, tone]) => (
                        <span key={key} className={cx('rounded px-1.5 py-0.5 text-[11px] ring-1 ring-inset', t.summary[key] ? tone : 'text-slate-600 ring-white/5')}>
                          {label} {t.summary[key]}
                        </span>
                      ))}
                    </span>
                  ) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
