export interface Meta {
  history_first: string
  history_last: string
  replay_day: string
  slots: string[]
  users: number
  stages: Record<string, string>
  levels: { level: string; top_share: number; cutoff: number }[]
}

export type Level = 'High' | 'Medium' | 'Watch' | 'Normal'

export interface Reason {
  reason: string
  weight: number
}

export interface MonitoredUser {
  user: string
  role: string | null
  risk: number
  previous_risk: number | null
  percentile: number
  previous_percentile: number | null
  level: Level
  stage: number
  stage_name: string
  stage_first: Record<string, string | null>
  story: string
  reasons: Reason[]
  events: number
}

export interface Snapshot {
  upload: number
  file: string
  as_of: string
  new_events: number
  total_events: number
  window: [string | null, string]
  summary: { monitored: number; high: number; medium: number; watch: number; normal: number; staging_plus: number }
  users: MonitoredUser[]
}

export interface TimelinePoint {
  upload: number
  as_of: string
  file: string
  new_events: number
  summary: Snapshot['summary']
  risks: Record<string, number>
  percentiles: Record<string, number>
  stages: Record<string, number>
}

export interface Truth {
  attacker: boolean
  scenario: number | null
  replayed_insider: string | null
}

export interface Realtime {
  replay_day: string
  latest: Snapshot | null
  timeline: TimelinePoint[]
  truth: Record<string, Truth> | null
}

export interface HistoryData {
  start: string
  end: string
  includes_replay_day: boolean
  kpis: { user_days: number; users: number; alerts: number; users_alerted: number; high_alerts: number; users_staging_plus: number }
  series: { day: string; alerts: number; high: number; active_users: number }[]
  stage_counts: Record<string, number>
  top_users: {
    user: string
    role: string | null
    peak_risk: number
    peak_pct: number
    peak_level: Level
    max_stage: number
    max_stage_name: string
    alert_days: number
    active_days: number
    last_alert: string | null
    last_story: string | null
    insider?: boolean
  }[]
  alerts: { user: string; role: string | null; day: string; risk: number; pct: number; level: string; story: string; truth?: boolean | null }[]
  truth?: { attack_days: number; attack_days_alerted: number; attackers: number; attackers_alerted: number; alerts: number; real_alerts: number }
}

export interface UserHistory {
  user: string
  role: string | null
  start: string
  end: string
  series: { day: string; risk: number; pct: number; stage: number; usb_n?: number; file_n?: number; http_job?: number; http_leak?: number; logon_after_hours?: number; http_cloud?: number; email_ext_attachments?: number }[]
  alerts: { day: string; risk: number; pct: number; level: string; story: string }[]
  peak_risk: number
  peak_pct: number
  peak_level: Level
  max_stage: number
  cutoffs: Record<string, number>
}

export interface DayEvent {
  time: string
  hour: number
  source: 'logon' | 'device' | 'file' | 'email' | 'http'
  text: string
  flags: string[]
}

export interface DayEvents {
  user: string
  day: string
  primary_pc?: string
  work_hours?: [number, number]
  events: DayEvent[]
}

async function get<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}, signal?: AbortSignal): Promise<T> {
  const q = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => v !== undefined && v !== '' && q.set(k, String(v)))
  const res = await fetch(`${path}?${q}`, { signal })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? res.statusText)
  return res.json()
}

async function post<T>(path: string, body: unknown = {}): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? res.statusText)
  return res.json()
}

export const api = {
  meta: () => get<Meta>('/api/meta'),
  realtime: (evalMode: boolean) => get<Realtime>('/api/realtime', { eval_mode: evalMode }),
  upload: (name: string, content: string) => post<{ upload: number; as_of: string; new_events: number }>('/api/realtime/upload', { name, content }),
  reset: () => post('/api/realtime/reset'),
  events: (user: string) => get<DayEvents>(`/api/realtime/events/${user}`),
  users: (q: string, signal?: AbortSignal) => get<{ user: string; role: string | null }[]>('/api/users', { q }, signal),
  history: (start: string, end: string, evalMode: boolean, signal?: AbortSignal) =>
    get<HistoryData>('/api/history', { start, end, eval_mode: evalMode }, signal),
  userHistory: (user: string, start: string, end: string) => get<UserHistory>(`/api/history/user/${user}`, { start, end }),
}
