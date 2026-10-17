import { ArrowLeft, Ban, CircleCheck, CircleSlash, CircleDollarSign, Cpu, ExternalLink, Hash, Hourglass, Quote, RotateCw, Timer, Undo2, XCircle } from 'lucide-react'
import { useState } from 'react'
import { useBackend } from '../../lib/backend.jsx'
import { friendlyError } from '../../lib/errors.js'
import { useNow } from '../../lib/hooks.js'
import { fmtCompact, fmtCost, fmtDateTime, fmtDuration, fmtRelative, truncate } from '../../lib/format.js'
import { isActive, taskDurationSec } from '../../lib/pipeline.js'
import { navigate, taskHref } from '../../lib/router.js'
import { Avatar, ModeChip, SourceIcon, StatusChip } from '../Chips.jsx'
import { CopyButton, InlineConfirm, Spinner } from '../Misc.jsx'
import { useToast } from '../Toasts.jsx'

export function TaskActions({ task, project }) {
  const { backend, requester } = useBackend()
  const toast = useToast()
  const [busy, setBusy] = useState(null)

  const run = async (name, fn, onOk) => {
    setBusy(name)
    try {
      const res = await fn()
      onOk?.(res)
    } catch (err) {
      toast({ tone: 'critical', title: `Could not ${name}`, message: friendlyError(err) })
    } finally {
      setBusy(null)
    }
  }

  const approve = () =>
    run('approve', () => backend.approve(task.id, requester), (res) =>
      toast({ tone: 'good', title: 'Released to production', message: `${res?.release?.revision || 'The preview'} now serves 100% of traffic.` }),
    )
  const reject = () => run('reject', () => backend.reject(task.id, requester), () => toast({ tone: 'info', title: 'Change rejected', message: 'Production is unchanged.' }))
  const rollback = () =>
    run('roll back', () => backend.rollback(task.id, requester), (res) =>
      toast({ tone: 'warning', title: 'Rolled back', message: `Production restored${res?.release?.revision ? ` to ${res.release.revision}` : ''}.` }),
    )
  const retry = () =>
    run('retry', () => backend.retry(task.id, requester), (res) => {
      toast({ tone: 'good', title: 'Retry launched', message: `New task ${res?.id} is queued.` })
      if (res?.id) navigate(taskHref(res.id))
    })
  const cancel = () => run('cancel', () => backend.cancel(task.id, requester), () => toast({ tone: 'info', title: 'Task cancelled' }))

  const open = (url) => (backend.openUrl ? backend.openUrl(url) : window.open(url, '_blank', 'noopener,noreferrer'))
  const isProd = project?.prodTaskId === task.id
  const s = task.status

  return (
    <div className="task-actions">
      {task.preview?.url && (
        <button type="button" className="btn btn-sm" onClick={() => open(task.preview.url)}>
          <ExternalLink size={14} aria-hidden="true" /> Open preview
        </button>
      )}
      {task.release?.url && s === 'deployed' && (
        <button type="button" className="btn btn-sm" onClick={() => open(task.release.url)}>
          <ExternalLink size={14} aria-hidden="true" /> Open production
        </button>
      )}
      {s === 'queued' && (
        <button type="button" className="btn btn-sm" onClick={cancel} disabled={!!busy}>
          {busy === 'cancel' ? <Spinner size={14} /> : <CircleSlash size={14} aria-hidden="true" />} Cancel
        </button>
      )}
      {['failed', 'rejected', 'cancelled'].includes(s) && (
        <button type="button" className="btn btn-sm btn-primary" onClick={retry} disabled={!!busy}>
          {busy === 'retry' ? <Spinner size={14} /> : <RotateCw size={14} aria-hidden="true" />} Retry
        </button>
      )}
      {s === 'deployed' && isProd && (
        <InlineConfirm
          size="btn-sm"
          tone="warning"
          icon={<Undo2 size={14} aria-hidden="true" />}
          label="Roll back"
          confirmLabel="Roll back"
          message="Restore the previous production release?"
          onConfirm={rollback}
          disabled={!!busy}
        />
      )}
      {s === 'awaiting_approval' && (
        <>
          <InlineConfirm
            size="btn-sm"
            tone="danger"
            icon={<Ban size={14} aria-hidden="true" />}
            label="Reject"
            confirmLabel="Reject"
            message="Discard this preview?"
            onConfirm={reject}
            disabled={!!busy}
          />
          <button type="button" className="btn btn-primary" onClick={approve} disabled={!!busy}>
            {busy === 'approve' ? <Spinner size={16} /> : <CircleCheck size={16} aria-hidden="true" />} Approve &amp; release
          </button>
        </>
      )}
    </div>
  )
}

export function TaskHeader({ task, project }) {
  const now = useNow(isActive(task) ? 1000 : 30000)
  const m = task.metrics || {}
  const tokens = (Number(m.tokensIn) || 0) + (Number(m.tokensOut) || 0)
  const error = task.error && (typeof task.error === 'string' ? task.error : task.error.message || JSON.stringify(task.error))
  const gate = task.status === 'awaiting_approval'
  return (
    <header className="task-header">
      <a href="#/" className="back-link">
        <ArrowLeft size={14} aria-hidden="true" /> Command Center
      </a>
      <div className="task-title-row">
        <div className="task-title-main">
          <h1 className="task-title">{task.title || truncate(task.prompt, 120)}</h1>
          <div className="task-chips">
            <StatusChip status={task.status} />
            <ModeChip mode={task.mode} />
            {project?.prodTaskId === task.id && task.status === 'deployed' && <span className="chip tone-good">In production</span>}
          </div>
        </div>
        <TaskActions task={task} project={project} />
      </div>
      <dl className="task-meta">
        <div className="meta-item">
          <dt className="sr-only">Requested by</dt>
          <dd>
            <Avatar name={task.requestedBy?.name} size={20} /> {task.requestedBy?.name || 'Anonymous'}
          </dd>
        </div>
        <div className="meta-item">
          <dt className="sr-only">Source</dt>
          <dd>
            <SourceIcon source={task.source} withLabel />
          </dd>
        </div>
        <div className="meta-item" title={fmtDateTime(task.createdAt)}>
          <dt className="meta-key">Created</dt>
          <dd>{fmtRelative(task.createdAt, now)}</dd>
        </div>
        <div className="meta-item">
          <dt className="meta-key">
            <Timer size={13} aria-hidden="true" />
            <span className="sr-only">Duration</span>
          </dt>
          <dd>{fmtDuration(taskDurationSec(task, now))}</dd>
        </div>
        <div className="meta-item">
          <dt className="meta-key">
            <CircleDollarSign size={13} aria-hidden="true" />
            <span className="sr-only">AI cost</span>
          </dt>
          <dd>{fmtCost(m.costUsd)} AI cost</dd>
        </div>
        <div className="meta-item">
          <dt className="meta-key">
            <Cpu size={13} aria-hidden="true" />
            <span className="sr-only">Tokens</span>
          </dt>
          <dd>
            {fmtCompact(tokens)} tokens{m.llmCalls ? ` · ${m.llmCalls} LLM calls` : ''}
          </dd>
        </div>
        <div className="meta-item meta-id">
          <dt className="meta-key">
            <Hash size={13} aria-hidden="true" />
            <span className="sr-only">Task id</span>
          </dt>
          <dd>
            {task.id}
            <CopyButton text={task.id} label="Copy id" className="btn btn-ghost btn-xs btn-icon-only" />
          </dd>
        </div>
      </dl>
      <blockquote className="prompt-quote">
        <Quote size={16} className="prompt-quote-icon" aria-hidden="true" />
        <p>{task.prompt}</p>
      </blockquote>
      {error && (
        <div className="callout tone-critical" role="alert">
          <XCircle size={16} aria-hidden="true" />
          <div>
            <strong>Pipeline stopped.</strong> {error}
          </div>
        </div>
      )}
      {gate && (
        <div className="callout tone-warning gate">
          <Hourglass size={16} aria-hidden="true" />
          <div>
            <strong>Release gate: waiting for your approval.</strong>{' '}
            {[
              task.tests?.total != null && `Tests ${task.tests.passed ?? task.tests.total}/${task.tests.total} ✓`,
              task.review?.score != null && `Review ${task.review.score}/100 ✓`,
              task.verify?.checks?.length && `Live checks ${task.verify.checks.filter((c) => c.ok).length}/${task.verify.checks.length} ✓`,
            ]
              .filter(Boolean)
              .join(' · ')}
            {' — '}check the Diff and Live preview, then approve or reject above.
          </div>
        </div>
      )}
    </header>
  )
}
