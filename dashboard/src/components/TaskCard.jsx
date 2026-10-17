import { CircleDollarSign, Rocket, Timer } from 'lucide-react'
import { useNow } from '../lib/hooks.js'
import { fmtCost, fmtDateTime, fmtDuration, fmtRelative, truncate } from '../lib/format.js'
import { currentStage, isActive, taskDurationSec } from '../lib/pipeline.js'
import { taskHref } from '../lib/router.js'
import { Avatar, SourceIcon, StatusChip } from './Chips.jsx'
import { StageBar } from './StageBar.jsx'

export function TaskCard({ task, inProduction = false }) {
  const active = isActive(task)
  const now = useNow(active ? 1000 : 30000)
  const stage = active ? currentStage(task) : null
  const who = task.requestedBy?.name || 'Anonymous'
  return (
    <a className={`task-card${active ? ' is-active' : ''}`} href={taskHref(task.id)}>
      <div className="task-card-top">
        <SourceIcon source={task.source} />
        <h3 className="task-card-title">{task.title || truncate(task.prompt, 90)}</h3>
        <StatusChip status={task.status} />
      </div>
      {task.title && <p className="task-card-prompt">{truncate(task.prompt, 170)}</p>}
      <div className="task-card-progress">
        <StageBar task={task} />
        {stage && (
          <span className="task-card-stage">
            {stage.agent} · {stage.label}
          </span>
        )}
        {inProduction && (
          <span className="chip chip-xs tone-good">
            <Rocket size={11} aria-hidden="true" /> In production
          </span>
        )}
      </div>
      <div className="task-card-meta">
        <span className="meta-item">
          <Avatar name={who} size={18} />
          {who}
        </span>
        <span className="meta-item" title={fmtDateTime(task.createdAt)}>
          {fmtRelative(task.createdAt, now)}
        </span>
        <span className="meta-item" title="Duration">
          <Timer size={13} aria-hidden="true" />
          {fmtDuration(taskDurationSec(task, now))}
        </span>
        <span className="meta-item" title="AI cost">
          <CircleDollarSign size={13} aria-hidden="true" />
          {fmtCost(task.metrics?.costUsd)}
        </span>
        <span className="meta-id">#{task.id}</span>
      </div>
    </a>
  )
}
