import { ArrowRight, Hourglass, Satellite } from 'lucide-react'
import { useTaskEvents } from '../lib/backend.jsx'
import { useNow } from '../lib/hooks.js'
import { fmtElapsed, toMs, truncate } from '../lib/format.js'
import { currentStage } from '../lib/pipeline.js'
import { taskHref } from '../lib/router.js'
import { AgentAvatar } from './AgentAvatar.jsx'
import { ModeChip, SourceIcon, StatusChip } from './Chips.jsx'
import { Linkify } from './Linkify.jsx'
import { PipelineStepper } from './PipelineStepper.jsx'

function LiveTask({ task, others }) {
  const { events } = useTaskEvents(task.id)
  const now = useNow(1000)
  const start = toMs(task.startedAt) ?? toMs(task.createdAt)
  const t0 = toMs(task.createdAt)
  const stage = currentStage(task)
  const last = events.slice(-3)
  return (
    <section className="card live-card" aria-labelledby="live-title">
      <div className="live-card-head">
        <div className="live-card-main">
          <div className="eyebrow live-eyebrow">
            <span className="live-dot" aria-hidden="true" /> Live now
            {stage && (
              <span className="live-stage">
                · {stage.agent} — {stage.verb}
              </span>
            )}
          </div>
          <h2 id="live-title" className="live-card-title">
            <a href={taskHref(task.id)}>{task.title || truncate(task.prompt, 96)}</a>
          </h2>
          <div className="live-card-chips">
            <StatusChip status={task.status} />
            <ModeChip mode={task.mode} />
            <span className="meta-item">
              <SourceIcon source={task.source} withLabel />
            </span>
            <span className="meta-item">by {task.requestedBy?.name || 'Anonymous'}</span>
          </div>
        </div>
        <div className="mission-clock" aria-label="Mission time">
          <span className="mission-clock-label">Mission time</span>
          <span className="mission-clock-value">T+{fmtElapsed(start ? (now - start) / 1000 : 0)}</span>
        </div>
      </div>
      {task.title && <p className="live-card-prompt">“{truncate(task.prompt, 200)}”</p>}
      <PipelineStepper task={task} compact />
      <div className="live-card-foot">
        <ol className="live-log" aria-label="Latest agent activity">
          {!last.length && <li className="live-log-empty">Spinning up the sandbox…</li>}
          {last.map((ev) => (
            <li key={ev.id || ev.seq} className={`live-log-row kind-${ev.kind || 'info'}`}>
              <AgentAvatar agent={ev.agent} size={22} />
              <span className="live-log-agent">{ev.agent}</span>
              <span className="live-log-msg">
                <Linkify text={ev.message} />
              </span>
              <time className="live-log-time">T+{fmtElapsed(t0 ? (toMs(ev.ts) - t0) / 1000 : 0)}</time>
            </li>
          ))}
        </ol>
        <a className="btn btn-primary" href={taskHref(task.id)}>
          Open mission <ArrowRight size={16} aria-hidden="true" />
        </a>
      </div>
      {others.length > 0 && (
        <div className="live-others">
          <span className="muted">+{others.length} more in flight:</span>
          {others.slice(0, 4).map((o) => (
            <a key={o.id} href={taskHref(o.id)} className="live-other">
              <span className="live-dot live-dot-sm" aria-hidden="true" />
              {truncate(o.title || o.prompt, 48)}
            </a>
          ))}
        </div>
      )}
    </section>
  )
}

export function LiveNow({ tasks }) {
  const active = tasks.filter((t) => t.status === 'running' || t.status === 'queued').sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt))
  const awaiting = tasks.filter((t) => t.status === 'awaiting_approval')
  if (active.length) return <LiveTask key={active[0].id} task={active[0]} others={active.slice(1)} />
  return (
    <section className="card live-idle" aria-label="Live now">
      <span className="live-idle-icon" aria-hidden="true">
        <Satellite size={20} />
      </span>
      <div className="live-idle-text">
        <div className="eyebrow">Live now</div>
        <div className="live-idle-title">The crew is standing by</div>
        <div className="muted">Ship a change above and watch the crew take it through all ten stages to production in real time.</div>
      </div>
      {awaiting.length > 0 && (
        <a className="btn btn-warning-soft" href={taskHref(awaiting[0].id)}>
          <Hourglass size={15} aria-hidden="true" />
          {awaiting.length === 1 ? '1 change awaits your approval' : `${awaiting.length} changes await approval`}
        </a>
      )}
    </section>
  )
}
