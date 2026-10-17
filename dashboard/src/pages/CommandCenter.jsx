import { CircleCheck, Clock, Rocket, Satellite, Timer, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Composer } from '../components/Composer.jsx'
import { LiveNow } from '../components/LiveNow.jsx'
import { EmptyState, StatTile } from '../components/Misc.jsx'
import { TaskCard } from '../components/TaskCard.jsx'
import { useBackend } from '../lib/backend.jsx'
import { useDocumentTitle } from '../lib/hooks.js'
import { fmtDuration, fmtHours, fmtPct } from '../lib/format.js'
import { computeMetrics } from '../lib/metrics.js'

const PAGE = 12

export function CommandCenter() {
  useDocumentTitle('Command Center')
  const { tasks, tasksLoaded, tasksError, projects, startDemo } = useBackend()
  const [limit, setLimit] = useState(PAGE)
  const metrics = useMemo(() => computeMetrics(tasks, projects), [tasks, projects])
  const prodIds = useMemo(() => new Set(projects.map((p) => p.prodTaskId).filter(Boolean)), [projects])

  return (
    <div className="page page-home">
      <Composer />

      <section className="stat-row" aria-label="Delivery over the last 14 days">
        <StatTile
          label="Deploys · 14d"
          value={tasksLoaded ? metrics.deployCount : '—'}
          sub={tasksLoaded ? `${metrics.deployFrequency.toFixed(1)} per day` : 'loading…'}
          icon={Rocket}
        />
        <StatTile
          label="Median lead time"
          value={fmtDuration(metrics.leadTimeMedianSec)}
          sub={metrics.leadTimeP90Sec != null ? `prompt → prod · p90 ${fmtDuration(metrics.leadTimeP90Sec)}` : 'prompt → production'}
          icon={Timer}
        />
        <StatTile
          label="Pipeline success"
          value={fmtPct(metrics.pipelineSuccessRate)}
          sub={metrics.finishedCount ? `${metrics.successCount} of ${metrics.finishedCount} finished tasks` : 'no finished tasks yet'}
          icon={CircleCheck}
        />
        <StatTile
          label="Engineer-hours saved"
          value={fmtHours(metrics.hoursSaved)}
          sub={`across ${metrics.deployed} deployed ${metrics.deployed === 1 ? 'change' : 'changes'}`}
          icon={Clock}
        />
      </section>

      <LiveNow tasks={tasks} />

      <section className="feed" aria-labelledby="feed-title">
        <div className="section-head">
          <h2 id="feed-title">Recent tasks</h2>
          {tasksLoaded && <span className="count-pill">{tasks.length}</span>}
        </div>
        {tasksError ? (
          <div className="card">
            <EmptyState
              icon={TriangleAlert}
              title="Can’t load tasks"
              action={
                <button type="button" className="btn btn-sm" onClick={startDemo}>
                  Explore with demo data
                </button>
              }
            >
              {tasksError.message || 'The realtime connection to Firestore failed.'}
            </EmptyState>
          </div>
        ) : !tasksLoaded ? (
          <div className="feed-grid" aria-busy="true">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="task-card is-skeleton" aria-hidden="true">
                <span className="skeleton" style={{ width: '60%', height: 16 }} />
                <span className="skeleton" style={{ width: '90%' }} />
                <span className="skeleton" style={{ width: '100%', height: 6 }} />
                <span className="skeleton" style={{ width: '45%' }} />
              </div>
            ))}
          </div>
        ) : !tasks.length ? (
          <div className="card">
            <EmptyState
              icon={Satellite}
              title="No missions yet"
              action={
                <button type="button" className="btn btn-sm" onClick={() => document.getElementById('composer-prompt')?.focus()}>
                  Write your first request
                </button>
              }
            >
              Describe a change in the composer above and press <strong>Ship it</strong> — the crew takes it from prompt to production.
            </EmptyState>
          </div>
        ) : (
          <>
            <div className="feed-grid">
              {tasks.slice(0, limit).map((t) => (
                <TaskCard key={t.id} task={t} inProduction={prodIds.has(t.id) && t.status === 'deployed'} />
              ))}
            </div>
            {tasks.length > limit && (
              <div className="feed-more">
                <button type="button" className="btn btn-sm" onClick={() => setLimit((l) => l + PAGE)}>
                  Show more ({tasks.length - limit} older)
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}
