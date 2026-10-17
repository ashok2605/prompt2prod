// Pipeline vocabulary from docs/SPEC.md: stage keys, agents, statuses.
// Every agent has one fixed icon + colour token used everywhere in the UI.
import {
  Ban, Bot, CheckCheck, CircleCheck, CircleSlash, Clock, Code2, Compass, Cpu,
  Flag, FlaskConical, Hourglass, LoaderCircle, Package, Radar, Rocket, ShieldCheck,
  Undo2, XCircle,
} from 'lucide-react'
import { toMs } from './format.js'

export const STAGES = [
  { key: 'sandbox', label: 'Sandbox', agent: 'Orchestrator', verb: 'Starting sandbox' },
  { key: 'plan', label: 'Plan', agent: 'Planner', verb: 'Planning the change' },
  { key: 'tests', label: 'Tests first', agent: 'Test Author', verb: 'Writing failing tests' },
  { key: 'code', label: 'Implement', agent: 'Coder', verb: 'Implementing' },
  { key: 'test', label: 'Test & heal', agent: 'Test Runner', verb: 'Running tests' },
  { key: 'review', label: 'AI review', agent: 'Reviewer', verb: 'Reviewing the diff' },
  { key: 'build', label: 'Build', agent: 'Builder', verb: 'Building container' },
  { key: 'preview', label: 'Preview', agent: 'Deployer', verb: 'Deploying preview' },
  { key: 'verify', label: 'Verify live', agent: 'Verifier', verb: 'Verifying live preview' },
  { key: 'release', label: 'Release', agent: 'Release Manager', verb: 'Releasing' },
]

export const STAGE_KEYS = STAGES.map((s) => s.key)
export const STAGE_BY_KEY = Object.fromEntries(STAGES.map((s) => [s.key, s]))

export const AGENTS = {
  Orchestrator: { icon: Cpu, cls: 'orchestrator' },
  Planner: { icon: Compass, cls: 'planner' },
  'Test Author': { icon: FlaskConical, cls: 'testauthor' },
  Coder: { icon: Code2, cls: 'coder' },
  'Test Runner': { icon: CheckCheck, cls: 'testrunner' },
  Reviewer: { icon: ShieldCheck, cls: 'reviewer' },
  Builder: { icon: Package, cls: 'builder' },
  Deployer: { icon: Rocket, cls: 'deployer' },
  Verifier: { icon: Radar, cls: 'verifier' },
  'Release Manager': { icon: Flag, cls: 'release' },
}

export function agentMeta(name) {
  return AGENTS[name] || { icon: Bot, cls: 'orchestrator' }
}

export function agentForStage(stageKey) {
  return STAGE_BY_KEY[stageKey]?.agent || 'Orchestrator'
}

// Task statuses. `tone` maps to the reserved status palette (always shown
// with an icon + label, never colour alone).
export const STATUS = {
  queued: { label: 'Queued', tone: 'neutral', icon: Clock },
  running: { label: 'Running', tone: 'info', icon: LoaderCircle, spin: true },
  awaiting_approval: { label: 'Awaiting approval', tone: 'warning', icon: Hourglass },
  deployed: { label: 'Deployed', tone: 'good', icon: CircleCheck },
  failed: { label: 'Failed', tone: 'critical', icon: XCircle },
  rejected: { label: 'Rejected', tone: 'neutral', icon: Ban },
  rolled_back: { label: 'Rolled back', tone: 'serious', icon: Undo2 },
  cancelled: { label: 'Cancelled', tone: 'neutral', icon: CircleSlash },
}

export const STATUS_ORDER = ['deployed', 'awaiting_approval', 'running', 'queued', 'rolled_back', 'failed', 'rejected', 'cancelled']

export function statusMeta(status) {
  return STATUS[status] || { label: status || 'Unknown', tone: 'neutral', icon: Clock }
}

export const ACTIVE_STATUSES = new Set(['queued', 'running'])
export const isActive = (task) => ACTIVE_STATUSES.has(task?.status)

/** Status of one stage: pending | running | done | failed | skipped | waiting */
export function stageStatus(task, key) {
  return task?.stages?.[key]?.status || 'pending'
}

/** Duration (seconds) of a stage; live for running stages. */
export function stageDurationSec(task, key, now = Date.now()) {
  const s = task?.stages?.[key]
  if (!s) return null
  const start = toMs(s.startedAt)
  if (start == null) return null
  const end = toMs(s.endedAt) ?? (s.status === 'running' || s.status === 'waiting' ? now : null)
  if (end == null) return null
  return Math.max(0, (end - start) / 1000)
}

/** The stage the crew is working on right now (or the one it stopped at). */
export function currentStage(task) {
  if (!task) return null
  const running = STAGES.find((s) => ['running', 'waiting'].includes(stageStatus(task, s.key)))
  if (running) return running
  if (task.stage && STAGE_BY_KEY[task.stage]) return STAGE_BY_KEY[task.stage]
  const failed = STAGES.find((s) => stageStatus(task, s.key) === 'failed')
  return failed || null
}

export function stagesDone(task) {
  return STAGES.filter((s) => ['done', 'skipped'].includes(stageStatus(task, s.key))).length
}

/** Total wall-clock duration of a task (seconds); ticking while active. */
export function taskDurationSec(task, now = Date.now()) {
  if (!task) return null
  const start = toMs(task.startedAt) ?? toMs(task.createdAt)
  if (isActive(task)) return start == null ? null : Math.max(0, (now - start) / 1000)
  if (task.metrics?.durationSec != null) return task.metrics.durationSec
  if (start == null) return null
  const end = toMs(task.finishedAt) ?? toMs(task.updatedAt) ?? now
  return Math.max(0, (end - start) / 1000)
}

export const SOURCE_LABEL = { dashboard: 'Typed', voice: 'Voice', api: 'API', webhook: 'Webhook' }
