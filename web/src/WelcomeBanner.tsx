import { useId } from 'react'
import { FileText, Globe, KeyRound, Laptop, Mail, Usb } from 'lucide-react'
import { fmtDay } from './ui'

const CX = 230
const CY = 104
const RX = 172
const RY = 72

const SOURCES = [
  { label: 'Logon', icon: KeyRound, angle: -90 },
  { label: 'Email', icon: Mail, angle: -30 },
  { label: 'Web', icon: Globe, angle: 30 },
  { label: 'USB', icon: Usb, angle: 90, alert: true },
  { label: 'Files', icon: FileText, angle: 150 },
  { label: 'Devices', icon: Laptop, angle: 210 },
]

function point(angle: number) {
  const a = (angle * Math.PI) / 180
  return { x: CX + RX * Math.cos(a), y: CY + RY * Math.sin(a) }
}

function Illustration() {
  const id = useId().replace(/:/g, '')
  return (
    <svg viewBox="0 0 460 210" className="h-full w-full overflow-visible" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-core`}>
          <stop offset="0" stopColor="#22d3ee" stopOpacity="0.4" />
          <stop offset="0.6" stopColor="#2563eb" stopOpacity="0.1" />
          <stop offset="1" stopColor="#2563eb" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-shield`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#67e8f9" />
          <stop offset="0.55" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#818cf8" />
        </linearGradient>
        <pattern id={`${id}-grid`} width="12" height="12" patternUnits="userSpaceOnUse">
          <path d="M12 0H0V12" fill="none" stroke="#22d3ee" strokeOpacity="0.12" strokeWidth="0.6" />
        </pattern>
        <clipPath id={`${id}-disc`}><circle cx={CX} cy={CY} r="60" /></clipPath>
      </defs>

      <circle cx={CX} cy={CY} r="72" fill={`url(#${id}-core)`} />
      <rect x={CX - 60} y={CY - 60} width="120" height="120" fill={`url(#${id}-grid)`} clipPath={`url(#${id}-disc)`} />
      <ellipse cx={CX} cy={CY} rx={RX} ry={RY} fill="none" stroke="#22d3ee" strokeOpacity="0.16" strokeDasharray="2 6" />
      <circle cx={CX} cy={CY} r="44" fill="none" stroke="#22d3ee" strokeOpacity="0.28" />
      <circle cx={CX} cy={CY} r="58" fill="none" stroke="#3b82f6" strokeOpacity="0.3" strokeDasharray="4 5" className="emblem-sweep" style={{ transformOrigin: `${CX}px ${CY}px` }} />

      {SOURCES.map((s, i) => {
        const p = point(s.angle)
        const bend = { x: (p.x + CX) / 2 - (p.y - CY) * 0.25, y: (p.y + CY) / 2 + (p.x - CX) * 0.08 }
        const color = s.alert ? '#fb7185' : '#38bdf8'
        const dur = `${2.6 + i * 0.3}s`
        return (
          <g key={s.label}>
            <path id={`${id}-l${i}`} d={`M${p.x} ${p.y} Q${bend.x} ${bend.y} ${CX} ${CY}`} fill="none" stroke={color} strokeOpacity={s.alert ? 0.55 : 0.3} strokeWidth="1.2" />
            <circle r="2.6" fill={s.alert ? '#fda4af' : '#a5f3fc'} opacity="0">
              <animateMotion dur={dur} begin={`${i * 0.45}s`} repeatCount="indefinite">
                <mpath href={`#${id}-l${i}`} />
              </animateMotion>
              <animate attributeName="opacity" values="0;1;1;0" dur={dur} begin={`${i * 0.45}s`} repeatCount="indefinite" />
            </circle>
          </g>
        )
      })}

      {SOURCES.map((s) => {
        const p = point(s.angle)
        const Icon = s.icon
        const labelY = s.angle === -90 ? p.y - 23 : p.y + 30
        return (
          <g key={`n-${s.label}`}>
            {s.alert && <circle cx={p.x} cy={p.y} r="22" fill="none" stroke="#fb7185" className="node-alert" />}
            <circle cx={p.x} cy={p.y} r="16" fill="#0a1426" stroke={s.alert ? '#fb7185' : '#22d3ee'} strokeOpacity={s.alert ? 0.9 : 0.55} strokeWidth="1.3" />
            <Icon x={p.x - 8} y={p.y - 8} width={16} height={16} color={s.alert ? '#fda4af' : '#67e8f9'} strokeWidth={1.8} />
            <text x={p.x} y={labelY} textAnchor="middle" fontSize="9.5" fontWeight="500" letterSpacing="1" fill={s.alert ? '#fda4af' : '#94a3b8'}>
              {s.label.toUpperCase()}
            </text>
          </g>
        )
      })}

      <g transform={`translate(${CX} ${CY}) scale(1.3) translate(-24 -24)`}>
        <path d="M24 4 39 9.5v12.2c0 9.6-6.3 17.6-15 21.3C15.3 39.3 9 31.3 9 21.7V9.5L24 4Z" fill="#071022" stroke={`url(#${id}-shield)`} strokeWidth="2" strokeLinejoin="round" />
        <path d="M17.5 24c1.8-3.4 4-5 6.5-5s4.7 1.6 6.5 5c-1.8 3.4-4 5-6.5 5s-4.7-1.6-6.5-5Z" fill="none" stroke={`url(#${id}-shield)`} strokeWidth="1.6" strokeLinejoin="round" />
        <circle cx="24" cy="24" r="2.2" fill="#e0f2fe" />
      </g>
    </svg>
  )
}

export default function WelcomeBanner({ users, day }: { users: number; day: string }) {
  return (
    <header className="flex items-center gap-10">
      <div className="min-w-0 flex-1 px-6 py-6">
        <div className="text-xs font-medium uppercase tracking-[0.25em] text-cyan-300/80">Shield</div>
        <h1 className="font-display mt-2 text-2xl font-bold tracking-[0.12em] text-slate-50 sm:text-3xl">INSIDER THREAT OVERVIEW</h1>
        <p className="mt-2 max-w-xl text-sm text-slate-300">
          Monitoring {users.toLocaleString()} employees across logon, USB, file, email and web activity
        </p>
        <p className="mt-1 font-mono text-xs text-slate-500">{fmtDay(day)}</p>
      </div>
      <div className="hidden h-52 w-[440px] shrink-0 lg:block">
        <Illustration />
      </div>
    </header>
  )
}
