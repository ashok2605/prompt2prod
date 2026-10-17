import { AppWindow, CheckCheck, Code2, Compass, Radar, SearchX, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { EventLog } from '../components/EventLog.jsx'
import { EmptyState, Tabs } from '../components/Misc.jsx'
import { PipelineStepper } from '../components/PipelineStepper.jsx'
import { TaskHeader } from '../components/task/TaskHeader.jsx'
import { DiffTab, OverviewTab, PreviewTab, ReviewTab, TestsTab, VerifyTab } from '../components/task/TaskTabs.jsx'
import { useBackend, useTask, useTaskEvents } from '../lib/backend.jsx'
import { diffTotals, parseDiff } from '../lib/diff.js'
import { useDocumentTitle, useFitToViewport } from '../lib/hooks.js'
import { truncate } from '../lib/format.js'
import { taskHref } from '../lib/router.js'

const TAB_KEYS = ['overview', 'diff', 'tests', 'review', 'preview', 'verify']

function useTabs(task) {
  const files = task?.files?.length ? task.files : null
  const totals = files
    ? files.reduce((a, f) => ({ add: a.add + (f.additions || 0), del: a.del + (f.deletions || 0) }), { add: 0, del: 0 })
    : task?.diff
      ? (() => {
          const t = diffTotals(parseDiff(task.diff))
          return { add: t.additions, del: t.deletions }
        })()
      : null
  const v = task?.verify?.checks
  const vPassed = v ? v.filter((c) => c.ok).length : 0
  const t = task?.tests
  const testsGreen = t && t.total != null && t.failed === 0
  return [
    { key: 'overview', label: 'Overview', icon: Compass },
    { key: 'diff', label: 'Diff', icon: Code2, badge: totals ? `+${totals.add} −${totals.del}` : null },
    { key: 'tests', label: 'Tests', icon: CheckCheck, badge: t?.total != null && t.passed != null ? `${t.passed}/${t.total}` : null, badgeTone: t?.total != null && t.passed != null ? (testsGreen ? 'good' : 'critical') : null },
    { key: 'review', label: 'Review', icon: ShieldCheck, badge: task?.review?.score ?? null },
    { key: 'preview', label: 'Live preview', shortLabel: 'Preview', icon: AppWindow, live: !!task?.preview?.url },
    { key: 'verify', label: 'Verify', icon: Radar, badge: v?.length ? `${vPassed}/${v.length}` : null, badgeTone: v?.length ? (vPassed === v.length ? 'good' : 'critical') : null },
  ]
}

export function TaskPage({ id, tab: routeTab }) {
  const { task, error } = useTask(id)
  const { events, loaded } = useTaskEvents(id)
  const { projects } = useBackend()
  const [tab, setTab] = useState(TAB_KEYS.includes(routeTab) ? routeTab : 'overview')
  const [waitedLong, setWaitedLong] = useState(false)
  const tabs = useTabs(task)
  const logRef = useRef(null)
  useFitToViewport(logRef, { enabled: !!task })
  useDocumentTitle(task ? truncate(task.title || task.prompt, 60) : 'Task')

  useEffect(() => {
    if (TAB_KEYS.includes(routeTab)) setTab(routeTab)
  }, [routeTab])

  // A freshly created task can take a moment to appear in Firestore.
  useEffect(() => {
    setWaitedLong(false)
    const t = setTimeout(() => setWaitedLong(true), 5000)
    return () => clearTimeout(t)
  }, [id])

  const changeTab = (key) => {
    setTab(key)
    try {
      window.history.replaceState(null, '', taskHref(id, key === 'overview' ? null : key))
    } catch {
      /* ignore */
    }
  }

  if (error && !task) {
    return (
      <div className="page">
        <div className="card">
          <EmptyState icon={SearchX} title="Couldn’t load this task" action={<a className="btn btn-sm" href="#/">Back to Command Center</a>}>
            {error.message || String(error)}
          </EmptyState>
        </div>
      </div>
    )
  }

  if (task === null && waitedLong) {
    return (
      <div className="page">
        <div className="card">
          <EmptyState icon={SearchX} title="Task not found" action={<a className="btn btn-sm" href="#/">Back to Command Center</a>}>
            There is no task with id <span className="mono">{id}</span>.
          </EmptyState>
        </div>
      </div>
    )
  }

  if (!task) {
    return (
      <div className="page page-task" aria-busy="true">
        <div className="skeleton" style={{ width: 160, height: 14 }} />
        <div className="skeleton" style={{ width: '55%', height: 28, marginTop: 14 }} />
        <div className="skeleton" style={{ width: '35%', height: 14, marginTop: 12 }} />
        <div className="card skeleton-card" style={{ height: 120, marginTop: 24 }} />
        <div className="task-grid">
          <div className="card skeleton-card" style={{ height: 380 }} />
          <div className="card skeleton-card" style={{ height: 380 }} />
        </div>
      </div>
    )
  }

  const project = projects.find((p) => p.id === task.projectId)
  return (
    <div className="page page-task">
      <TaskHeader task={task} project={project} />
      <section className="card stepper-card" aria-label="Pipeline">
        <PipelineStepper task={task} />
      </section>
      <div className="task-grid">
        <section className="card tabs-card">
          <Tabs tabs={tabs} active={tab} onChange={changeTab} label="Task details" idBase="task" />
          <div className="tab-panel" role="tabpanel" id={`task-panel-${tab}`} aria-labelledby={`task-tab-${tab}`} tabIndex={0}>
            {tab === 'overview' && <OverviewTab task={task} />}
            {tab === 'diff' && <DiffTab task={task} />}
            {tab === 'tests' && <TestsTab task={task} />}
            {tab === 'review' && <ReviewTab task={task} />}
            {tab === 'preview' && <PreviewTab task={task} project={project} />}
            {tab === 'verify' && <VerifyTab task={task} />}
          </div>
        </section>
        <aside className="log-column" ref={logRef}>
          <EventLog task={task} events={events} loaded={loaded} />
        </aside>
      </div>
    </div>
  )
}
