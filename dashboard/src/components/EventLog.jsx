import { Activity, ArrowDown, ChevronRight, CircleCheck, Hourglass, Pause, Play, Sparkles, TriangleAlert, Wrench, XCircle } from 'lucide-react'
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { usePrefersReducedMotion } from '../lib/hooks.js'
import { fmtDateTime, fmtElapsed, toMs } from '../lib/format.js'
import { STAGE_BY_KEY, agentForStage, currentStage } from '../lib/pipeline.js'
import { AgentAvatar } from './AgentAvatar.jsx'
import { Linkify, RichText } from './Linkify.jsx'
import { EmptyState } from './Misc.jsx'

const KIND_ICON = { tool: Wrench, success: CircleCheck, warn: TriangleAlert, error: XCircle, thought: Sparkles }
const STAGE_FALLBACK = { queued: 'Queue', done: 'Release' }

function stageLabel(key) {
  return STAGE_BY_KEY[key]?.label || STAGE_FALLBACK[key] || key || 'Pipeline'
}

function EventRow({ ev, t0, fresh }) {
  const [open, setOpen] = useState(false)
  const kind = KIND_ICON[ev.kind] ? ev.kind : 'info'
  const KindIcon = KIND_ICON[kind]
  const ts = toMs(ev.ts)
  return (
    <li className={`log-row kind-${kind}${fresh ? ' is-fresh' : ''}`}>
      <AgentAvatar agent={ev.agent} size={26} />
      <div className="log-body">
        <div className="log-meta">
          <span className="log-agent">{ev.agent || 'System'}</span>
          {ts != null && (
            <time className="log-time" dateTime={new Date(ts).toISOString()} title={fmtDateTime(ts)}>
              T+{fmtElapsed(t0 != null ? (ts - t0) / 1000 : 0)}
            </time>
          )}
        </div>
        <div className="log-message">
          {KindIcon && <KindIcon size={13} className="log-kind-icon" aria-label={kind} />}
          <span>
            <RichText text={ev.message} />
          </span>
        </div>
        {ev.detail && (
          <>
            <button type="button" className="log-detail-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              <ChevronRight size={13} className="chev" aria-hidden="true" />
              {open ? 'Hide details' : 'Details'}
            </button>
            {open && (
              <pre className="log-detail">
                <Linkify text={ev.detail} />
              </pre>
            )}
          </>
        )}
      </div>
    </li>
  )
}

function Typing({ task, events }) {
  if (!task) return null
  if (task.status === 'awaiting_approval') {
    return (
      <li className="log-typing is-waiting">
        <AgentAvatar agent="Release Manager" size={26} />
        <span>
          <Hourglass size={13} aria-hidden="true" /> Release Manager is waiting for your approval
        </span>
      </li>
    )
  }
  if (task.status === 'queued') {
    return (
      <li className="log-typing">
        <AgentAvatar agent="Orchestrator" size={26} active />
        <span>
          Waiting for a sandbox<span className="dots" aria-hidden="true"><i /><i /><i /></span>
        </span>
      </li>
    )
  }
  if (task.status !== 'running') return null
  const stage = currentStage(task)
  const last = events[events.length - 1]
  const agent = last && last.stage === stage?.key ? last.agent : agentForStage(stage?.key)
  return (
    <li className="log-typing">
      <AgentAvatar agent={agent} size={26} active />
      <span>
        {agent} is working<span className="dots" aria-hidden="true"><i /><i /><i /></span>
      </span>
    </li>
  )
}

/** Sticky, auto-scrolling live agent log. */
export function EventLog({ task, events, loaded }) {
  const [follow, setFollow] = useState(true)
  const [atBottom, setAtBottom] = useState(true)
  const listRef = useRef(null)
  const reduced = usePrefersReducedMotion()
  const firstCount = useRef(null)
  const live = task?.status === 'running' || task?.status === 'queued'
  const t0 = toMs(task?.createdAt)

  if (loaded && firstCount.current === null) firstCount.current = events.length

  const rows = useMemo(() => {
    const out = []
    let prevStage = null
    events.forEach((ev, i) => {
      if (ev.stage !== prevStage) {
        out.push({ divider: true, key: `d-${i}-${ev.stage}`, stage: ev.stage })
        prevStage = ev.stage
      }
      out.push({ ev, key: ev.id || `${ev.seq}-${i}`, index: i })
    })
    return out
  }, [events])

  // Follow the newest event. Instant scroll on purpose: smooth scrolling emits
  // intermediate scroll events that would read as "user scrolled up".
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el || !follow || !atBottom) return
    el.scrollTop = el.scrollHeight
  }, [events.length, follow, atBottom, task?.status])

  useEffect(() => {
    if (follow) setAtBottom(true)
  }, [follow])

  const onScroll = () => {
    const el = listRef.current
    if (!el) return
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 56)
  }

  const jump = () => {
    const el = listRef.current
    if (!el) return
    setAtBottom(true)
    el.scrollTo({ top: el.scrollHeight, behavior: reduced ? 'auto' : 'smooth' })
  }

  return (
    <section className="card log-card" aria-label="Live agent log">
      <header className="log-header">
        <div className="log-title">
          <Activity size={16} aria-hidden="true" />
          <span>Live agent log</span>
          {live && (
            <span className="live-pill">
              <span className="live-dot live-dot-sm" aria-hidden="true" />
              LIVE
            </span>
          )}
        </div>
        <div className="log-actions">
          <span className="muted small">{events.length} events</span>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            aria-pressed={!follow}
            onClick={() => setFollow((f) => !f)}
            title={follow ? 'Pause auto-scroll' : 'Resume auto-scroll'}
          >
            {follow ? <Pause size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
            {follow ? 'Pause' : 'Follow'}
          </button>
        </div>
      </header>
      <ol className="log-list" ref={listRef} onScroll={onScroll} role="log" aria-live="off">
        {!loaded && (
          <li className="log-skeleton" aria-hidden="true">
            <span className="skeleton" style={{ width: '70%' }} />
            <span className="skeleton" style={{ width: '55%' }} />
            <span className="skeleton" style={{ width: '62%' }} />
          </li>
        )}
        {loaded && !events.length && !live && (
          <li>
            <EmptyState compact icon={Activity} title="No events yet">
              Agent activity will stream here as soon as the crew starts.
            </EmptyState>
          </li>
        )}
        {rows.map((row) =>
          row.divider ? (
            <li key={row.key} className="log-divider">
              <span>{stageLabel(row.stage)}</span>
            </li>
          ) : (
            <Fragment key={row.key}>
              <EventRow ev={row.ev} t0={t0} fresh={firstCount.current != null && row.index >= firstCount.current} />
            </Fragment>
          ),
        )}
        <Typing task={task} events={events} />
      </ol>
      {(!atBottom || !follow) && events.length > 6 && (
        <button type="button" className="log-jump" onClick={() => (follow ? jump() : (setFollow(true), jump()))}>
          <ArrowDown size={13} aria-hidden="true" /> Latest
        </button>
      )}
    </section>
  )
}
