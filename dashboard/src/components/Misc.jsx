import { Check, Copy, LoaderCircle, Moon, Sun } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { readStorage, writeStorage } from '../lib/storage.js'

export function Spinner({ size = 16 }) {
  return <LoaderCircle size={size} className="spin" aria-hidden="true" />
}

export function EmptyState({ icon: Icon, title, children, action, compact = false }) {
  return (
    <div className={`empty${compact ? ' empty-compact' : ''}`}>
      {Icon && (
        <span className="empty-icon" aria-hidden="true">
          <Icon size={compact ? 18 : 22} />
        </span>
      )}
      {title && <h3 className="empty-title">{title}</h3>}
      {children && <div className="empty-text">{children}</div>}
      {action}
    </div>
  )
}

/** Button that turns into an inline "Are you sure?" confirm (never window.confirm). */
export function InlineConfirm({ label, icon, message, confirmLabel, tone = 'danger', onConfirm, disabled, size = '' }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!asking) {
    return (
      <button type="button" className={`btn btn-${tone} ${size}`} onClick={() => setAsking(true)} disabled={disabled}>
        {icon}
        {label}
      </button>
    )
  }
  const run = async () => {
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
      setAsking(false)
    }
  }
  return (
    <div className="inline-confirm" role="group" aria-label={message} onKeyDown={(e) => e.key === 'Escape' && !busy && setAsking(false)}>
      <span className="inline-confirm-msg">{message}</span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAsking(false)} disabled={busy}>
        Cancel
      </button>
      {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
      <button type="button" className={`btn btn-${tone} btn-sm`} onClick={run} disabled={busy} autoFocus>
        {busy ? <Spinner size={14} /> : icon}
        {confirmLabel}
      </button>
    </div>
  )
}

export function CopyButton({ text, label = 'Copy', className = 'btn btn-ghost btn-sm' }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
      } catch {
        /* nothing else to try */
      }
      ta.remove()
    }
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1600)
  }
  return (
    <button type="button" className={className} onClick={copy} aria-label={copied ? 'Copied' : label}>
      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      <span>{copied ? 'Copied' : label}</span>
    </button>
  )
}

export function ThemeToggle({ className = 'btn btn-ghost btn-icon' }) {
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme') || readStorage('p2p-theme', 'dark'))
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    writeStorage('p2p-theme', theme)
  }, [theme])
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <button type="button" className={className} onClick={() => setTheme(next)} aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}>
      {theme === 'dark' ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
    </button>
  )
}

export function Tabs({ tabs, active, onChange, label = 'Sections', idBase = 'tab' }) {
  const onKeyDown = (e) => {
    const idx = tabs.findIndex((t) => t.key === active)
    let next = null
    if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length
    if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length
    if (e.key === 'Home') next = 0
    if (e.key === 'End') next = tabs.length - 1
    if (next == null) return
    e.preventDefault()
    onChange(tabs[next].key)
    document.getElementById(`${idBase}-tab-${tabs[next].key}`)?.focus()
  }
  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((t) => {
        const Icon = t.icon
        const selected = t.key === active
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`${idBase}-tab-${t.key}`}
            aria-controls={`${idBase}-panel-${t.key}`}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={`tab${selected ? ' is-active' : ''}`}
            onClick={() => onChange(t.key)}
          >
            {Icon && <Icon size={15} aria-hidden="true" />}
            <span className={t.shortLabel ? 'tab-label-long' : undefined}>{t.label}</span>
            {t.shortLabel && <span className="tab-label-short">{t.shortLabel}</span>}
            {t.badge != null && t.badge !== '' && <span className={`tab-badge${t.badgeTone ? ` tone-${t.badgeTone}` : ''}`}>{t.badge}</span>}
            {t.live && <span className="live-dot live-dot-sm" aria-hidden="true" />}
          </button>
        )
      })}
    </div>
  )
}

export function ScoreRing({ score, size = 116 }) {
  const value = Math.max(0, Math.min(100, Number(score) || 0))
  const stroke = 8
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const tone = value >= 85 ? 'good' : value >= 70 ? 'warning' : 'critical'
  return (
    <div className={`score-ring tone-${tone}`} style={{ width: size, height: size }} role="img" aria-label={`Quality score ${value} out of 100`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="score-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" />
        <circle
          className="score-value"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - value / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="score-label">
        <span className="score-num">{value}</span>
        <span className="score-of">/100</span>
      </div>
    </div>
  )
}

export function StatTile({ label, value, sub, icon: Icon, tier }) {
  return (
    <div className="stat-tile">
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        {Icon && <Icon className="stat-icon" size={16} aria-hidden="true" />}
      </div>
      <div className="stat-value">{value}</div>
      {(sub || tier) && (
        <div className="stat-sub">
          {tier}
          {sub && <span>{sub}</span>}
        </div>
      )}
    </div>
  )
}
