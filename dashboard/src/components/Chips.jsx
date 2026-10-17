import { Award, Braces, Keyboard, Mic, OctagonAlert, Shield, ShieldCheck, TriangleAlert, Webhook, Zap } from 'lucide-react'
import { SOURCE_LABEL, statusMeta } from '../lib/pipeline.js'
import { initials } from '../lib/format.js'

export function StatusChip({ status, className = '' }) {
  const m = statusMeta(status)
  const Icon = m.icon
  if (status === 'running') {
    return (
      <span className={`chip chip-running ${className}`}>
        <span className="live-dot" aria-hidden="true" />
        {m.label}
      </span>
    )
  }
  return (
    <span className={`chip tone-${m.tone} ${className}`}>
      <Icon size={13} aria-hidden="true" />
      {m.label}
    </span>
  )
}

export function ModeChip({ mode }) {
  return mode === 'approval' ? (
    <span className="chip tone-neutral" title="Waits for a human approval before release">
      <Shield size={13} aria-hidden="true" />
      Approval
    </span>
  ) : (
    <span className="chip chip-accent" title="Auto-releases when all gates pass">
      <Zap size={13} aria-hidden="true" />
      Autopilot
    </span>
  )
}

const RISK = {
  low: { tone: 'good', icon: ShieldCheck, label: 'Low risk' },
  medium: { tone: 'warning', icon: TriangleAlert, label: 'Medium risk' },
  high: { tone: 'critical', icon: OctagonAlert, label: 'High risk' },
}

export function RiskChip({ risk }) {
  const r = RISK[risk]
  if (!r) return null
  const Icon = r.icon
  return (
    <span className={`chip tone-${r.tone}`}>
      <Icon size={13} aria-hidden="true" />
      {r.label}
    </span>
  )
}

const SOURCE_ICON = { dashboard: Keyboard, voice: Mic, api: Braces, webhook: Webhook }

export function SourceIcon({ source, withLabel = false, size = 14 }) {
  const Icon = SOURCE_ICON[source] || Keyboard
  const label = SOURCE_LABEL[source] || source || 'Typed'
  return (
    <span className="source" title={`Source: ${label}`}>
      <Icon size={size} aria-hidden="true" />
      {withLabel ? <span>{label}</span> : <span className="sr-only">{label}</span>}
    </span>
  )
}

const TIER_TONE = { Elite: 'good', High: 'info', Medium: 'warning', Low: 'serious' }

export function TierChip({ tier }) {
  if (!tier) return null
  return (
    <span className={`chip chip-xs tone-${TIER_TONE[tier] || 'neutral'}`} title="DORA performance tier">
      <Award size={11} aria-hidden="true" />
      {tier}
    </span>
  )
}

const FILE_STATUS = { A: ['good', 'Added'], M: ['info', 'Modified'], D: ['critical', 'Deleted'], R: ['warning', 'Renamed'] }

export function FileStatusChip({ status }) {
  const [tone, label] = FILE_STATUS[status] || FILE_STATUS.M
  return (
    <span className={`file-status tone-${tone}`} title={label} aria-label={label}>
      {status || 'M'}
    </span>
  )
}

export function Avatar({ name, size = 22 }) {
  const label = name || 'Anonymous'
  const hue = [...label].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)
  return (
    <span className="avatar" style={{ width: size, height: size, '--hue': hue, fontSize: Math.round(size * 0.42) }} aria-hidden="true">
      {initials(label)}
    </span>
  )
}
