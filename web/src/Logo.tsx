import { useId } from 'react'
import { cx } from './ui'

export function LogoMark({ size = 36, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={cx('drop-shadow-[0_0_10px_rgba(34,211,238,0.45)]', className)} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-stroke`} x1="8" y1="4" x2="40" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#67e8f9" />
          <stop offset="0.55" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#818cf8" />
        </linearGradient>
        <linearGradient id={`${id}-fill`} x1="24" y1="4" x2="24" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#22d3ee" stopOpacity="0.22" />
          <stop offset="1" stopColor="#1d4ed8" stopOpacity="0.06" />
        </linearGradient>
      </defs>
      <path d="M24 4 39 9.5v12.2c0 9.6-6.3 17.6-15 21.3C15.3 39.3 9 31.3 9 21.7V9.5L24 4Z" fill={`url(#${id}-fill)`} stroke={`url(#${id}-stroke)`} strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M15 24h4M29 24h4M24 13v4M24 31v4" stroke="#22d3ee" strokeOpacity="0.55" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="15" cy="24" r="1.3" fill="#67e8f9" />
      <circle cx="33" cy="24" r="1.3" fill="#67e8f9" />
      <path d="M17.5 24c1.8-3.4 4-5 6.5-5s4.7 1.6 6.5 5c-1.8 3.4-4 5-6.5 5s-4.7-1.6-6.5-5Z" stroke={`url(#${id}-stroke)`} strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="24" cy="24" r="2.4" fill="#e0f2fe" />
      <circle cx="24" cy="24" r="1.1" fill="#0b1120" />
    </svg>
  )
}

export function Logo({ size = 36, tagline = true }: { size?: number; tagline?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark size={size} />
      <span className="leading-none">
        <span className="font-display block text-[17px] font-bold tracking-[0.22em] text-slate-50">SHIELD</span>
        {tagline && <span className="mt-1 block text-[9.5px] font-medium tracking-[0.18em] text-cyan-300/80">INSIDER THREAT DETECTION</span>}
      </span>
    </span>
  )
}
