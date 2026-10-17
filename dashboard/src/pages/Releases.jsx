import { Cpu, ExternalLink, FolderGit2, Globe, History, RotateCcw, Rocket, Undo2, Zap } from 'lucide-react'
import { useState } from 'react'
import { Avatar } from '../components/Chips.jsx'
import { EmptyState, InlineConfirm } from '../components/Misc.jsx'
import { useToast } from '../components/Toasts.jsx'
import { useBackend } from '../lib/backend.jsx'
import { friendlyError } from '../lib/errors.js'
import { useDocumentTitle, useNow } from '../lib/hooks.js'
import { fmtDateTime, fmtRelative, shortSha, toMs, truncate } from '../lib/format.js'
import { taskHref } from '../lib/router.js'

const KIND = {
  release: { icon: Rocket, tone: 'good', label: 'Release' },
  rollback: { icon: Undo2, tone: 'serious', label: 'Rollback' },
  reset: { icon: RotateCcw, tone: 'info', label: 'Reset' },
}

function By({ by }) {
  if (by === 'autopilot')
    return (
      <span className="by">
        <Zap size={13} aria-hidden="true" /> Autopilot
      </span>
    )
  if (by === 'system')
    return (
      <span className="by">
        <Cpu size={13} aria-hidden="true" /> System
      </span>
    )
  return (
    <span className="by">
      <Avatar name={by} size={18} /> {by || 'Unknown'}
    </span>
  )
}

function ProjectCard({ project, tasks }) {
  const { backend, requester } = useBackend()
  const toast = useToast()
  const prodTask = tasks.find((t) => t.id === project.prodTaskId)
  const open = (url) => (backend?.openUrl ? backend.openUrl(url) : window.open(url, '_blank', 'noopener,noreferrer'))
  const reset = async () => {
    try {
      await backend.resetProject(project.id, requester)
      toast({ tone: 'good', title: 'Demo reset to baseline', message: `${project.name || project.id} production is back on the baseline revision.` })
    } catch (err) {
      toast({ tone: 'critical', title: 'Reset failed', message: friendlyError(err) })
    }
  }
  return (
    <section className="card project-card" aria-labelledby={`proj-${project.id}`}>
      <div className="project-head">
        <div>
          <div className="eyebrow">Project</div>
          <h2 id={`proj-${project.id}`} className="project-name">
            {project.name || project.id}
          </h2>
          {project.description && <p className="muted">{project.description}</p>}
          {project.stack && (
            <div className="stack-chips">
              {project.stack.split('·').map((s) => (
                <span key={s} className="chip tone-neutral">
                  {s.trim()}
                </span>
              ))}
            </div>
          )}
        </div>
        <InlineConfirm
          size="btn-sm"
          tone="warning"
          icon={<RotateCcw size={14} aria-hidden="true" />}
          label="Reset demo to baseline"
          confirmLabel="Reset"
          message="Move production back to the baseline revision?"
          onConfirm={reset}
        />
      </div>
      {project.prodUrl && (
        <div className="prod-url">
          <Globe size={16} aria-hidden="true" />
          <a className="link mono" href={project.prodUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => (backend?.previewDoc ? (e.preventDefault(), open(project.prodUrl)) : null)}>
            {project.prodUrl.replace(/^https?:\/\//, '')}
          </a>
          <button type="button" className="btn btn-sm" onClick={() => open(project.prodUrl)}>
            <ExternalLink size={14} aria-hidden="true" /> Open
          </button>
        </div>
      )}
      <dl className="project-facts">
        <div>
          <dt>Current revision</dt>
          <dd className="mono">{project.prodRevision || '—'}</dd>
        </div>
        <div>
          <dt>Current commit</dt>
          <dd className="mono">{shortSha(project.prodCommit)}</dd>
        </div>
        <div>
          <dt>In production</dt>
          <dd>
            {project.prodTaskId ? (
              <a className="link" href={taskHref(project.prodTaskId)}>
                {prodTask ? truncate(prodTask.title || prodTask.prompt, 44) : `Task ${project.prodTaskId}`}
              </a>
            ) : (
              'Baseline'
            )}
          </dd>
        </div>
        <div>
          <dt>Service</dt>
          <dd className="mono">
            {project.service || project.id}
            {project.region ? ` · ${project.region}` : ''}
          </dd>
        </div>
      </dl>
    </section>
  )
}

function Timeline({ project }) {
  const now = useNow(30000)
  const releases = [...(project.releases || [])].sort((a, b) => (toMs(b.at) ?? 0) - (toMs(a.at) ?? 0))
  if (!releases.length) {
    return (
      <div className="card">
        <EmptyState icon={History} title="No releases yet">
          Releases, rollbacks and resets appear here as soon as the crew ships something.
        </EmptyState>
      </div>
    )
  }
  const liveIndex = releases.findIndex((r) => r.revision === project.prodRevision)
  return (
    <section className="card timeline-card" aria-labelledby="timeline-title">
      <div className="card-head">
        <h2 id="timeline-title" className="card-title">
          Release timeline
        </h2>
        <span className="muted small">{releases.length} events · newest first</span>
      </div>
      <ol className="timeline">
        {releases.map((r, i) => {
          const k = KIND[r.kind] || KIND.release
          const Icon = k.icon
          return (
            <li key={`${r.at}-${i}`} className={`tl-item tone-${k.tone}${i === liveIndex ? ' is-live' : ''}`}>
              <span className="tl-node" aria-hidden="true">
                <Icon size={14} />
              </span>
              <div className="tl-body">
                <div className="tl-top">
                  <span className={`chip chip-xs tone-${k.tone}`}>{k.label}</span>
                  {r.taskId ? (
                    <a className="tl-title" href={taskHref(r.taskId)}>
                      {r.title || `Task ${r.taskId}`}
                    </a>
                  ) : (
                    <span className="tl-title">{r.title || k.label}</span>
                  )}
                  {i === liveIndex && (
                    <span className="chip chip-xs tone-good">
                      <span className="live-dot live-dot-sm live-dot-good" aria-hidden="true" /> Live in production
                    </span>
                  )}
                </div>
                <div className="tl-meta">
                  <span className="mono">{r.revision || '—'}</span>
                  <span className="mono">{shortSha(r.commit)}</span>
                  <By by={r.by} />
                  <span title={fmtDateTime(r.at)}>{fmtRelative(r.at, now)}</span>
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

export function Releases() {
  useDocumentTitle('Releases')
  const { projects, projectsLoaded, tasks } = useBackend()
  const [selected, setSelected] = useState(null)
  const project = projects.find((p) => p.id === selected) || projects[0]
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Releases</h1>
          <p className="page-sub">What is live in production, and every release, rollback and reset that got it there.</p>
        </div>
        {projects.length > 1 && (
          <label className="field">
            <span className="field-label">
              <FolderGit2 size={13} aria-hidden="true" /> Project
            </span>
            <select className="select" value={project?.id} onChange={(e) => setSelected(e.target.value)}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || p.id}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {!project ? (
        <div className="card">
          <EmptyState icon={FolderGit2} title={projectsLoaded ? 'No projects yet' : 'Loading projects…'} />
        </div>
      ) : (
        <div className="releases-grid">
          <ProjectCard project={project} tasks={tasks} />
          <Timeline project={project} />
        </div>
      )}
    </div>
  )
}
