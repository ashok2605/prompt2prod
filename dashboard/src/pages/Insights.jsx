import { CircleDollarSign, FlaskConical, Gauge, HeartPulse, Rocket, RotateCw, Timer, Clock } from 'lucide-react'
import { useMemo } from 'react'
import { ChartCard, ColumnChart, DataTable, HBarChart } from '../components/charts/Charts.jsx'
import { TierChip } from '../components/Chips.jsx'
import { StatTile } from '../components/Misc.jsx'
import { useBackend } from '../lib/backend.jsx'
import { useDocumentTitle } from '../lib/hooks.js'
import { fmtCompact, fmtCost, fmtDay, fmtDuration, fmtHours, fmtPct, truncate } from '../lib/format.js'
import { computeMetrics, doraTier } from '../lib/metrics.js'
import { STATUS_ORDER, statusMeta } from '../lib/pipeline.js'

const fmtMin = (m) => (m >= 10 ? `${Math.round(m)}m` : `${m.toFixed(1).replace(/\.0$/, '')}m`)

export function Insights() {
  useDocumentTitle('Insights')
  const { tasks, projects, tasksLoaded } = useBackend()
  const m = useMemo(() => computeMetrics(tasks, projects), [tasks, projects])

  // Deployments per day (14 columns). Label every 4th day from today, plus the peak value.
  const days = m.perDay.map((d, i) => {
    const last = i === m.perDay.length - 1
    const showLabel = (m.perDay.length - 1 - i) % 4 === 0
    return {
      key: d.key,
      value: d.count,
      label: showLabel ? (last ? 'Today' : fmtDay(d.start, { month: 'short', day: 'numeric' })) : null,
      tip: { value: `${d.count} ${d.count === 1 ? 'deploy' : 'deploys'}`, label: fmtDay(d.start) },
      aria: `${fmtDay(d.start)}: ${d.count} deploys`,
    }
  })
  const peak = days.reduce((best, d, i) => (d.value > (days[best]?.value ?? -1) ? i : best), -1)

  const leads = m.leadSeries.map((d, i) => ({
    key: d.id || i,
    value: d.minutes,
    valueLabel: fmtMin(d.minutes),
    label: null,
    tip: { value: fmtDuration(d.minutes * 60), label: truncate(d.title, 46) },
    aria: `${truncate(d.title, 60)}: lead time ${fmtDuration(d.minutes * 60)}`,
  }))
  const leadPeak = leads.reduce((best, d, i) => (d.value > (leads[best]?.value ?? -1) ? i : best), -1)
  if (leads.length) {
    leads[0].label = 'oldest'
    leads[leads.length - 1].label = 'latest'
  }
  const medianMin = m.leadTimeMedianSec != null ? m.leadTimeMedianSec / 60 : null

  const statusRows = m.statusCounts
    .filter((s) => s.count > 0 || ['deployed', 'failed'].includes(s.status))
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status))
    .map((s) => {
      const meta = statusMeta(s.status)
      return { key: s.status, label: meta.label, icon: meta.icon, tone: meta.tone === 'neutral' ? 'neutral' : meta.tone, value: s.count }
    })

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Insights</h1>
          <p className="page-sub">
            DORA and AI-productivity metrics for the last {m.windowDays} days · computed live from {tasksLoaded ? m.taskCount : '…'} tasks
          </p>
        </div>
      </div>

      <h2 className="section-label">DORA metrics</h2>
      <section className="stat-row" aria-label="DORA metrics">
        <StatTile
          label="Deployment frequency"
          value={`${m.deployFrequency.toFixed(2).replace(/0$/, '')}/day`}
          sub={`${m.deployCount} releases in ${m.windowDays} days`}
          tier={<TierChip tier={doraTier('deployFrequency', m.deployFrequency)} />}
          icon={Rocket}
        />
        <StatTile
          label="Median lead time"
          value={fmtDuration(m.leadTimeMedianSec)}
          sub={m.leadTimeP90Sec != null ? `p90 ${fmtDuration(m.leadTimeP90Sec)}` : 'prompt → production'}
          tier={<TierChip tier={doraTier('leadTime', m.leadTimeMedianSec)} />}
          icon={Timer}
        />
        <StatTile
          label="Change failure rate"
          value={fmtPct(m.changeFailureRate)}
          sub={m.deployed + m.rolledBack ? `${m.rolledBack} of ${m.deployed + m.rolledBack} changes rolled back` : 'no releases yet'}
          tier={<TierChip tier={doraTier('changeFailureRate', m.changeFailureRate)} />}
          icon={Gauge}
        />
        <StatTile
          label="Mean time to restore"
          value={m.mttrSec != null ? fmtDuration(m.mttrSec) : '—'}
          sub={m.rollbackCount ? `release → rollback · ${m.rollbackCount} ${m.rollbackCount === 1 ? 'rollback' : 'rollbacks'}` : 'no rollbacks in window'}
          tier={<TierChip tier={doraTier('mttr', m.mttrSec)} />}
          icon={HeartPulse}
        />
      </section>

      <h2 className="section-label">AI productivity</h2>
      <section className="stat-row" aria-label="AI productivity">
        <StatTile label="Tests written by AI" value={fmtCompact(m.testsWritten)} sub="tests-first, before any code" icon={FlaskConical} />
        <StatTile label="Self-healed runs" value={fmtCompact(m.selfHealed)} sub="red → green without a human" icon={RotateCw} />
        <StatTile label="Engineer-hours saved" value={fmtHours(m.hoursSaved)} sub="planner estimates, deployed tasks" icon={Clock} />
        <StatTile
          label="AI cost per change"
          value={fmtCost(m.costPerChange)}
          sub={`${fmtCost(m.costTotal)} total · ${fmtCompact(m.tokens)} tokens`}
          icon={CircleDollarSign}
        />
      </section>

      <div className="charts-grid">
        <ChartCard
          className="span-2"
          title="Deployments per day"
          subtitle={`Releases promoted to production · last ${m.windowDays} days`}
          table={
            <DataTable
              caption="Deployments per day"
              columns={[
                { key: 'day', label: 'Day' },
                { key: 'count', label: 'Deploys', numeric: true },
              ]}
              rows={m.perDay.map((d) => ({ day: fmtDay(d.start), count: d.count }))}
            />
          }
        >
          <ColumnChart data={days} integer labelIndex={peak} ariaLabel="Deployments per day over the last 14 days" empty="No deployments in this window yet." />
        </ChartCard>

        <ChartCard
          title="Lead time per change"
          subtitle="Minutes from prompt to production · last 20 releases"
          table={
            <DataTable
              caption="Lead time per change"
              columns={[
                { key: 'title', label: 'Change' },
                { key: 'lead', label: 'Lead time', numeric: true },
                { key: 'when', label: 'Released' },
              ]}
              rows={m.leadSeries
                .slice()
                .reverse()
                .map((d) => ({ title: truncate(d.title, 60), lead: fmtDuration(d.minutes * 60), when: fmtDay(d.promotedAt) }))}
            />
          }
        >
          <ColumnChart
            data={leads}
            yFormat={(v) => `${v}m`}
            labelIndex={leadPeak}
            reference={medianMin != null ? { value: medianMin, label: `median ${fmtMin(medianMin)}` } : null}
            ariaLabel="Lead time in minutes for the last 20 releases"
            empty="No releases yet."
          />
        </ChartCard>

        <ChartCard
          title="Tasks by status"
          subtitle={`All tasks created in the last ${m.windowDays} days`}
          table={
            <DataTable
              caption="Tasks by status"
              columns={[
                { key: 'status', label: 'Status' },
                { key: 'count', label: 'Tasks', numeric: true },
              ]}
              rows={statusRows.map((r) => ({ status: r.label, count: r.value }))}
            />
          }
        >
          <HBarChart data={statusRows} ariaLabel="Tasks by status" />
        </ChartCard>
      </div>
    </div>
  )
}
