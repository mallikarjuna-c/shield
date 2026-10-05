import { useState } from 'react'
import { Check, Copy, Loader2, RefreshCw, ServerOff } from 'lucide-react'

const COMMAND = 'python -m server'

export default function ServerOffline({ checking, onRetry }: { checking: boolean; onRetry: () => void }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(COMMAND)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard unavailable */ }
  }

  return (
    <div className="flex min-h-full items-center justify-center py-10">
      <div className="w-full max-w-lg rounded-xl border border-white/10 bg-ink-900/80 p-8 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-amber-500/10 ring-1 ring-inset ring-amber-500/25">
          <ServerOff className="h-6 w-6 text-amber-300" />
        </div>
        <h2 className="mt-5 text-lg font-semibold text-slate-100">Shield server is not running</h2>
        <p className="mt-2 text-sm text-slate-400">The dashboard needs the Shield server for its data. Start it from the project folder:</p>

        <div className="mx-auto mt-5 flex max-w-xs items-center justify-between gap-3 rounded-lg bg-ink-950 px-4 py-2.5 ring-1 ring-inset ring-white/10">
          <code className="font-mono text-sm text-cyan-200">{COMMAND}</code>
          <button type="button" onClick={copy} title="Copy command" className="rounded p-1 text-slate-400 hover:bg-white/5 hover:text-slate-200">
            {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>

        <div className="mt-6 flex items-center justify-center gap-4">
          <span className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />Reconnecting automatically
          </span>
          <button type="button" onClick={onRetry} disabled={checking}
            className="flex h-9 items-center gap-1.5 rounded-md px-3 text-xs text-slate-300 ring-1 ring-inset ring-white/10 hover:bg-white/5 disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} />Retry now
          </button>
        </div>
      </div>
    </div>
  )
}
