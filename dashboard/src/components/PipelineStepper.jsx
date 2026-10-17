import { Check, Hourglass, Minus, X } from 'lucide-react'
import { useNow } from '../lib/hooks.js'
import { fmtDuration, fmtElapsed } from '../lib/format.js'
import { STAGES, agentMeta, isActive, stageDurationSec, stageStatus } from '../lib/pipeline.js'

const BADGE = { done: Check, failed: X, waiting: Hourglass, skipped: Minus }
const SR = { pending: 'pending', running: 'in progress', done: 'done', failed: 'failed', waiting: 'waiting for approval', skipped: 'skipped' }

function connector(status, next) {
  if (status === 'running') return 'active'
  if (status === 'waiting') return 'waiting'
  if (status === 'failed') return 'failed'
  if ((status === 'done' || status === 'skipped') && next && next !== 'pending') return 'done'
  return 'pending'
}

function metaText(status, secs) {
  switch (status) {
    case 'running':
      return secs != null ? `Running · ${fmtElapsed(secs)}` : 'Running'
    case 'done':
      return secs != null ? fmtDuration(secs) : 'Done'
    case 'failed':
      return secs != null ? `Failed · ${fmtDuration(secs)}` : 'Failed'
    case 'waiting':
      return 'Awaiting approval'
    case 'skipped':
      return 'Skipped'
    default:
      return 'Pending'
  }
}

/** The 10-node pipeline stepper. `compact` is the mini version for cards. */
export function PipelineStepper({ task, compact = false }) {
  const now = useNow(isActive(task) || task?.status === 'awaiting_approval' ? 1000 : 0)
  return (
    <ol className={`stepper${compact ? ' stepper-compact' : ''}`} aria-label="Pipeline stages">
      {STAGES.map((s, i) => {
        const status = stageStatus(task, s.key)
        const next = i < STAGES.length - 1 ? stageStatus(task, STAGES[i + 1].key) : null
        const meta = agentMeta(s.agent)
        const Icon = meta.icon
        const Badge = BADGE[status]
        const secs = stageDurationSec(task, s.key, now)
        const summary = task?.stages?.[s.key]?.summary
        return (
          <li
            key={s.key}
            className={`step is-${status}`}
            aria-current={status === 'running' ? 'step' : undefined}
            title={`${s.label} · ${s.agent}${summary ? ` — ${summary}` : ''}`}
          >
            <span className={`step-node agent-${meta.cls}`}>
              <Icon size={compact ? 14 : 18} strokeWidth={2} aria-hidden="true" />
              {Badge && (
                <span className="step-badge" aria-hidden="true">
                  <Badge size={compact ? 8 : 10} strokeWidth={3} />
                </span>
              )}
            </span>
            {i < STAGES.length - 1 && <span className={`step-connector is-${connector(status, next)}`} aria-hidden="true" />}
            <span className="step-label">{s.label}</span>
            {!compact && <span className="step-meta">{metaText(status, secs)}</span>}
            {!compact && summary && status !== 'pending' && <span className="step-summary">{summary}</span>}
            <span className="sr-only">
              {`, ${s.agent}, ${SR[status] || status}`}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
