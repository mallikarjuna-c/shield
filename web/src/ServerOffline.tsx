import { Loader2, RefreshCw, WifiOff } from 'lucide-react'

export default function ServerOffline({ checking, onRetry }: { checking: boolean; onRetry: () => void }) {
  return (
    <div className="flex min-h-full items-center justify-center py-10">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-white/5 ring-1 ring-inset ring-white/10">
          <WifiOff className="h-5 w-5 text-slate-400" />
        </div>
        <h2 className="mt-4 text-base font-semibold text-slate-100">Connection lost</h2>
        <p className="mt-1.5 flex items-center justify-center gap-2 text-sm text-slate-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />Trying to reconnect
        </p>
        <button type="button" onClick={onRetry} disabled={checking}
          className="mx-auto mt-5 flex h-9 items-center gap-1.5 rounded-md px-3 text-xs text-slate-300 ring-1 ring-inset ring-white/10 hover:bg-white/5 disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} />Retry
        </button>
      </div>
    </div>
  )
}
