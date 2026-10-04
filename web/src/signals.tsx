import { ArrowDownRight, ArrowUpRight } from 'lucide-react'

export const PALETTE = ['#f43f5e', '#f59e0b', '#a78bfa', '#38bdf8', '#34d399', '#e879f9', '#fb923c', '#22d3ee']

export function Trend({ now, before }: { now: number; before: number | null }) {
  if (before === null) return <span className="text-[11px] text-slate-600">new</span>
  const d = now - before
  if (Math.abs(d) < 0.5) return <span className="text-[11px] text-slate-600">±0</span>
  return d > 0
    ? <span className="inline-flex items-center text-[11px] text-rose-300"><ArrowUpRight className="h-3 w-3" />{d.toFixed(1)}</span>
    : <span className="inline-flex items-center text-[11px] text-emerald-300"><ArrowDownRight className="h-3 w-3" />{Math.abs(d).toFixed(1)}</span>
}
