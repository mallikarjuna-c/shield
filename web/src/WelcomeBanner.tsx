import { fmtDay } from './ui'

export default function WelcomeBanner({ users, day }: { users: number; day: string }) {
  return (
    <header className="px-6 pt-2">
      <div className="text-xs font-medium uppercase tracking-[0.25em] text-cyan-300/80">Shield</div>
      <h1 className="font-display mt-2 text-2xl font-bold tracking-[0.12em] text-slate-50 sm:text-3xl">INSIDER THREAT OVERVIEW</h1>
      <p className="mt-2 max-w-xl text-sm text-slate-300">
        Monitoring {users.toLocaleString()} employees across logon, USB, file, email and web activity
      </p>
      <p className="mt-1 font-mono text-xs text-slate-500">{fmtDay(day)}</p>
    </header>
  )
}
