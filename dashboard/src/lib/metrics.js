// DORA + productivity metrics, computed client-side with the formulas in
// docs/SPEC.md ("Metrics formulas"). Window = the last 14 calendar days
// (today included), selected by task `createdAt`.
import { toMs } from './format.js'
import { ACTIVE_STATUSES, STATUS_ORDER } from './pipeline.js'

export const WINDOW_DAYS = 14

export function dayKey(ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function median(values) {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Nearest-rank percentile (p in 0..1). */
export function percentile(values, p) {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))
  return s[idx]
}

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null)

/** Calendar-day buckets ending today (DST-safe: built from local dates). */
export function dayBuckets(now = Date.now(), days = WINDOW_DAYS) {
  const today = new Date(now)
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1 - i))
    return { key: dayKey(d.getTime()), start: d.getTime(), count: 0, tasks: [] }
  })
}

function leadTimeSec(task) {
  const promoted = toMs(task.release?.promotedAt)
  const created = toMs(task.createdAt)
  if (promoted == null || created == null) return task.metrics?.leadTimeSec ?? null
  return Math.max(0, (promoted - created) / 1000)
}

/**
 * MTTR = mean seconds between a release and the rollback that undid it,
 * from project `releases` (kind == rollback). A rollback is matched to the
 * release with the same taskId; if none, to the nearest preceding release.
 */
export function computeMttr(projects = [], since = 0) {
  const durations = []
  for (const project of projects) {
    const rel = (project.releases || [])
      .map((r) => ({ ...r, atMs: toMs(r.at) }))
      .filter((r) => r.atMs != null)
      .sort((a, b) => a.atMs - b.atMs)
    rel.forEach((r, i) => {
      if (r.kind !== 'rollback' || r.atMs < since) return
      let undone = null
      for (let j = i - 1; j >= 0 && !undone; j--) {
        if (rel[j].kind === 'release' && r.taskId && rel[j].taskId === r.taskId) undone = rel[j]
      }
      for (let j = i - 1; j >= 0 && !undone; j--) {
        if (rel[j].kind === 'release') undone = rel[j]
      }
      if (undone) durations.push((r.atMs - undone.atMs) / 1000)
    })
  }
  return { meanSec: mean(durations), count: durations.length }
}

export function computeMetrics(tasks = [], projects = [], now = Date.now(), days = WINDOW_DAYS) {
  const buckets = dayBuckets(now, days)
  const since = buckets[0].start
  const recent = tasks.filter((t) => (toMs(t.createdAt) ?? 0) >= since)
  const byStatus = (s) => recent.filter((t) => t.status === s).length

  // Deployment frequency: tasks with release.promotedAt, per calendar day.
  const bucketByKey = new Map(buckets.map((b) => [b.key, b]))
  const released = recent.filter((t) => toMs(t.release?.promotedAt) != null)
  for (const t of released) {
    const b = bucketByKey.get(dayKey(toMs(t.release.promotedAt)))
    if (b) {
      b.count++
      b.tasks.push(t)
    }
  }
  const deployCount = released.length

  // Lead time for changes: promotedAt − createdAt (median, p90).
  const leadTimes = released.map(leadTimeSec).filter((x) => x != null)

  const deployed = byStatus('deployed')
  const rolledBack = byStatus('rolled_back')
  const awaiting = byStatus('awaiting_approval')
  // user-cancelled requests never ran, so they are not pipeline outcomes
  const finished = recent.filter((t) => !ACTIVE_STATUSES.has(t.status) && t.status !== 'cancelled')

  const mttr = computeMttr(projects, since)

  // Productivity.
  const testsWritten = recent.reduce((sum, t) => sum + (Number(t.tests?.newTests) || 0), 0)
  const selfHealed = recent.filter((t) => {
    if (typeof t.tests?.selfHealed === 'boolean') return t.tests.selfHealed
    const attempts = (t.tests?.attempts || []).filter((a) => a.phase !== 'tdd')
    if (attempts.length <= 1) return false
    const last = attempts[attempts.length - 1]
    return (last?.failed ?? t.tests?.failed ?? 1) === 0
  }).length
  const hoursSaved = recent
    .filter((t) => t.status === 'deployed')
    .reduce((sum, t) => sum + (Number(t.plan?.estimatedHours) || 0), 0)
  const costed = recent.filter((t) => t.metrics?.costUsd != null)
  const costTotal = costed.reduce((sum, t) => sum + Number(t.metrics.costUsd || 0), 0)
  const tokens = recent.reduce((sum, t) => sum + (Number(t.metrics?.tokensIn) || 0) + (Number(t.metrics?.tokensOut) || 0), 0)

  const statusCounts = STATUS_ORDER.map((status) => ({ status, count: byStatus(status) }))
  const known = new Set(STATUS_ORDER)
  for (const t of recent) {
    if (!known.has(t.status)) {
      known.add(t.status)
      statusCounts.push({ status: t.status, count: byStatus(t.status) })
    }
  }

  // Lead time per task: the last 20 changes that reached production.
  const leadSeries = tasks
    .filter((t) => toMs(t.release?.promotedAt) != null)
    .sort((a, b) => toMs(a.release.promotedAt) - toMs(b.release.promotedAt))
    .slice(-20)
    .map((t) => ({
      id: t.id,
      title: t.title || t.prompt,
      status: t.status,
      promotedAt: toMs(t.release.promotedAt),
      minutes: (leadTimeSec(t) ?? 0) / 60,
    }))

  return {
    windowDays: days,
    since,
    taskCount: recent.length,
    deployCount,
    deployFrequency: deployCount / days,
    perDay: buckets,
    leadTimeMedianSec: median(leadTimes),
    leadTimeP90Sec: percentile(leadTimes, 0.9),
    changeFailureRate: deployed + rolledBack ? rolledBack / (deployed + rolledBack) : null,
    deployed,
    rolledBack,
    awaiting,
    mttrSec: mttr.meanSec,
    rollbackCount: mttr.count,
    finishedCount: finished.length,
    successCount: deployed + awaiting + rolledBack,
    pipelineSuccessRate: finished.length ? (deployed + awaiting + rolledBack) / finished.length : null,
    testsWritten,
    selfHealed,
    hoursSaved,
    costTotal,
    costPerChange: costed.length ? costTotal / costed.length : null,
    tokens,
    statusCounts,
    leadSeries,
  }
}

const HOUR = 3600
const DAY = 86400

/** DORA performance tier for a metric value (labels only; shown with an icon). */
export function doraTier(metric, value) {
  if (value == null || !Number.isFinite(value)) return null
  switch (metric) {
    case 'deployFrequency': // per day
      return value >= 1 ? 'Elite' : value >= 1 / 7 ? 'High' : value >= 1 / 30 ? 'Medium' : 'Low'
    case 'leadTime': // seconds
      return value < DAY ? 'Elite' : value < 7 * DAY ? 'High' : value < 30 * DAY ? 'Medium' : 'Low'
    case 'changeFailureRate':
      return value <= 0.15 ? 'Elite' : value <= 0.3 ? 'High' : value <= 0.45 ? 'Medium' : 'Low'
    case 'mttr': // seconds
      return value < HOUR ? 'Elite' : value < DAY ? 'High' : value < 7 * DAY ? 'Medium' : 'Low'
    default:
      return null
  }
}
