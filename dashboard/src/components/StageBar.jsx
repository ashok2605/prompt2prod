import { STAGES, stageStatus, stagesDone } from '../lib/pipeline.js'

const WORD = { pending: 'pending', running: 'running', done: 'done', failed: 'failed', skipped: 'skipped', waiting: 'waiting' }

/** 10-segment pipeline progress bar (one segment per stage). */
export function StageBar({ task }) {
  const current = STAGES.find((s) => ['running', 'waiting', 'failed'].includes(stageStatus(task, s.key)))
  const label = `Pipeline: ${stagesDone(task)} of ${STAGES.length} stages done${current ? `, ${current.label} ${WORD[stageStatus(task, current.key)]}` : ''}`
  return (
    <div className="stagebar" role="img" aria-label={label}>
      {STAGES.map((s) => {
        const st = stageStatus(task, s.key)
        return <span key={s.key} className={`stagebar-seg is-${st}`} title={`${s.label} · ${WORD[st] || st}`} />
      })}
    </div>
  )
}
