// Formatting helpers shared by every page. All timestamps flowing through the
// app are normalised with `toMs()` so Firestore Timestamps, ISO strings (REST),
// Dates and epoch-millis (mock) can be used interchangeably.

export function toMs(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const ms = Date.parse(value)
    return Number.isNaN(ms) ? null : ms
  }
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (typeof value.toDate === 'function') return value.toDate().getTime()
  if (typeof value.seconds === 'number') return value.seconds * 1000 + Math.round((value.nanoseconds || 0) / 1e6)
  return null
}

const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export function fmtRelative(value, now = Date.now()) {
  const ms = toMs(value)
  if (ms == null) return '—'
  const diff = now - ms
  if (diff < 0) return 'just now'
  if (diff < 10 * SEC) return 'just now'
  if (diff < MIN) return `${Math.floor(diff / SEC)}s ago`
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m ago`
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`
  if (diff < 2 * DAY) return 'yesterday'
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d ago`
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function fmtClock(value) {
  const ms = toMs(value)
  if (ms == null) return '—'
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

export function fmtDateTime(value) {
  const ms = toMs(value)
  if (ms == null) return '—'
  return new Date(ms).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export function fmtDay(value, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  const ms = toMs(value)
  if (ms == null) return '—'
  return new Date(ms).toLocaleDateString(undefined, opts)
}

/** 42s · 3m 12s · 1h 04m · 2d 3h */
export function fmtDuration(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '—'
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}s`
  if (s < 3600) {
    const m = Math.floor(s / 60)
    const r = s % 60
    return r ? `${m}m ${String(r).padStart(2, '0')}s` : `${m}m`
  }
  if (s < 86400) {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    return `${h}h ${String(m).padStart(2, '0')}m`
  }
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  return h ? `${d}d ${h}h` : `${d}d`
}

/** Mission clock: 0:42 · 12:05 · 1:02:03 */
export function fmtElapsed(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '0:00'
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const mm = h ? String(m).padStart(2, '0') : String(m)
  return `${h ? `${h}:` : ''}${mm}:${String(r).padStart(2, '0')}`
}

export function fmtCost(usd) {
  if (usd == null || !Number.isFinite(usd)) return '—'
  if (usd === 0) return '$0.00'
  if (usd < 0.001) return '<$0.001'
  if (usd < 1) return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}

export function fmtCompact(n, digits = 1) {
  if (n == null || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  const trim = (x) => x.toFixed(digits).replace(/\.0+$/, '')
  if (abs >= 1e9) return `${trim(n / 1e9)}B`
  if (abs >= 1e6) return `${trim(n / 1e6)}M`
  if (abs >= 1e4) return `${trim(n / 1e3)}K`
  return Math.round(n).toLocaleString()
}

export function fmtTokens(n) {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '')}K`
  return String(Math.round(n))
}

export function fmtPct(ratio, digits = 0) {
  if (ratio == null || !Number.isFinite(ratio)) return '—'
  return `${(ratio * 100).toFixed(digits)}%`
}

export function fmtHours(h) {
  if (h == null || !Number.isFinite(h)) return '—'
  return `${h % 1 === 0 ? h : h.toFixed(1)}h`
}

export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`
}

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function truncate(text, max = 140) {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s
}

export function shortSha(sha) {
  return sha ? String(sha).slice(0, 7) : '—'
}

export function hostOf(url) {
  try {
    return new URL(url).host
  } catch {
    return url || ''
  }
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '')
