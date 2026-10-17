import {
  AppWindow, CircleAlert, CircleCheck, CircleDashed, ExternalLink, Eye, FileCode2, GitCommitHorizontal, Info, Lock, OctagonAlert,
  RotateCw, TriangleAlert, XCircle,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { API_BASE } from '../../lib/api.js'
import { useBackend } from '../../lib/backend.jsx'
import { fmtDateTime, fmtDuration, fmtHours, fmtRelative, hostOf, shortSha } from '../../lib/format.js'
import { isActive } from '../../lib/pipeline.js'
import { AgentAvatar } from '../AgentAvatar.jsx'
import { FileStatusChip, RiskChip } from '../Chips.jsx'
import { DiffViewer } from '../DiffViewer.jsx'
import { Linkify, RichText } from '../Linkify.jsx'
import { CopyButton, EmptyState, ScoreRing } from '../Misc.jsx'

function Waiting({ agent, active, title, children }) {
  return (
    <div className="waiting">
      <AgentAvatar agent={agent} size={34} active={active} />
      <div>
        <div className="waiting-title">
          {title}
          {active && (
            <span className="dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          )}
        </div>
        {children && <div className="muted">{children}</div>}
      </div>
    </div>
  )
}

// ---- Overview ---------------------------------------------------------------
const MODEL_AGENT = { planner: 'Planner', testAuthor: 'Test Author', test_author: 'Test Author', coder: 'Coder', reviewer: 'Reviewer', verifier: 'Verifier', builder: 'Builder' }

export function OverviewTab({ task }) {
  const plan = task.plan
  const active = isActive(task)
  if (!plan) {
    return active ? (
      <Waiting agent="Planner" active title="The Planner is reading the repository">
        A plan with steps, acceptance criteria and risk appears here in a few seconds.
      </Waiting>
    ) : (
      <EmptyState compact icon={CircleDashed} title="No plan was produced">
        This task stopped before the Planner finished.
      </EmptyState>
    )
  }
  const verified = task.verify?.passed || task.status === 'deployed'
  const failed = ['failed', 'rejected', 'cancelled'].includes(task.status)
  const files = task.files?.length ? task.files : (plan.files || []).map((p) => ({ path: p, planned: true }))
  const models = Object.entries(task.metrics?.models || {})
  return (
    <div className="overview">
      <section className="ov-plan">
        <div className="ov-plan-head">
          <AgentAvatar agent="Planner" size={30} />
          <div>
            <div className="eyebrow">Plan</div>
            <p className="ov-summary">
              <RichText text={plan.summary} />
            </p>
          </div>
        </div>
        <div className="ov-facts">
          <RiskChip risk={plan.risk} />
          {plan.estimatedHours != null && (
            <span className="ov-fact">
              <strong>{fmtHours(plan.estimatedHours)}</strong> engineer time saved (est.)
            </span>
          )}
          {plan.commitMessage && (
            <span className="ov-fact mono" title="Planned commit message">
              <GitCommitHorizontal size={13} aria-hidden="true" /> {plan.commitMessage}
            </span>
          )}
        </div>
      </section>

      {plan.steps?.length > 0 && (
        <section>
          <h3 className="sub-title">Steps</h3>
          <ol className="ov-steps">
            {plan.steps.map((s, i) => (
              <li key={i}>
                <span className="ov-step-n" aria-hidden="true">
                  {i + 1}
                </span>
                <span>
                  <RichText text={s} />
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {plan.acceptance?.length > 0 && (
        <section>
          <h3 className="sub-title">
            Acceptance criteria
            <span className="sub-note">{verified ? 'verified by tests and live checks' : failed ? 'not verified' : 'pending verification'}</span>
          </h3>
          <ul className="ov-checks">
            {plan.acceptance.map((a, i) => (
              <li key={i} className={verified ? 'is-met' : ''}>
                {verified ? (
                  <CircleCheck size={16} className="tone-icon tone-good" aria-label="Met" />
                ) : (
                  <CircleDashed size={16} className="tone-icon tone-neutral" aria-label="Pending" />
                )}
                <span>
                  <RichText text={a} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {plan.testStrategy && (
        <section>
          <h3 className="sub-title">Test strategy</h3>
          <p className="ov-text">
            <RichText text={plan.testStrategy} />
          </p>
        </section>
      )}

      {files.length > 0 && (
        <section>
          <h3 className="sub-title">
            Files touched
            {files[0]?.planned && <span className="sub-note">planned</span>}
          </h3>
          <ul className="ov-files">
            {files.map((f) => (
              <li key={f.path}>
                {f.planned ? <FileCode2 size={14} className="tone-icon tone-neutral" aria-hidden="true" /> : <FileStatusChip status={f.status} />}
                <span className="mono ov-file-path">{f.path}</span>
                {!f.planned && (
                  <span className="ov-file-stats">
                    <span className="add">+{f.additions ?? 0}</span>
                    <span className="del">−{f.deletions ?? 0}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <DeliveryFacts task={task} />

      {models.length > 0 && (
        <section>
          <h3 className="sub-title">Models</h3>
          <ul className="ov-models">
            {models.map(([role, model]) => (
              <li key={role}>
                <AgentAvatar agent={MODEL_AGENT[role] || role} size={22} />
                <span className="ov-model-role">{MODEL_AGENT[role] || role}</span>
                <span className="mono ov-model-name">{model}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function DeliveryFacts({ task }) {
  const rows = []
  if (task.commit?.sha)
    rows.push({
      agent: 'Builder',
      label: 'Commit',
      value: (
        <>
          <span className="mono">{shortSha(task.commit.sha)}</span> on <span className="mono">{task.commit.branch}</span>
          {task.commit.message && <span className="muted"> — {task.commit.message}</span>}
        </>
      ),
    })
  if (task.build?.image || task.build?.durationSec != null)
    rows.push({
      agent: 'Builder',
      label: 'Build',
      value: (
        <>
          {task.build.durationSec != null && <span>{fmtDuration(task.build.durationSec)} · </span>}
          <span className="mono truncate-inline" title={task.build.image}>
            {task.build.image ? task.build.image.split('/').pop() : '—'}
          </span>
          {task.build.logUrl && (
            <a className="link" href={task.build.logUrl} target="_blank" rel="noopener noreferrer">
              {' '}
              Cloud Build logs <ExternalLink size={11} aria-hidden="true" />
            </a>
          )}
        </>
      ),
    })
  if (task.preview?.revision)
    rows.push({
      agent: 'Deployer',
      label: 'Preview',
      value: (
        <>
          <span className="mono">{task.preview.revision}</span> · tag <span className="mono">{task.preview.tag}</span>
        </>
      ),
    })
  if (task.release?.promotedAt)
    rows.push({
      agent: 'Release Manager',
      label: 'Release',
      value: (
        <>
          <span className="mono">{task.release.revision}</span> by {task.release.promotedBy || '—'} ·{' '}
          <span title={fmtDateTime(task.release.promotedAt)}>{fmtRelative(task.release.promotedAt)}</span>
          {task.release.previousRevision && <span className="muted"> (previous {task.release.previousRevision})</span>}
        </>
      ),
    })
  if (!rows.length) return null
  return (
    <section>
      <h3 className="sub-title">Delivery</h3>
      <ul className="ov-delivery">
        {rows.map((r) => (
          <li key={r.label}>
            <AgentAvatar agent={r.agent} size={22} />
            <span className="ov-delivery-label">{r.label}</span>
            <span className="ov-delivery-value">{r.value}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ---- Diff -------------------------------------------------------------------
export function DiffTab({ task }) {
  if (!task.diff) {
    return isActive(task) ? (
      <Waiting agent="Coder" active title="Waiting for the Coder">
        The unified diff appears once the implementation is written.
      </Waiting>
    ) : (
      <EmptyState compact icon={FileCode2} title="No diff">
        This task did not produce code changes.
      </EmptyState>
    )
  }
  return <DiffViewer diff={task.diff} />
}

// ---- Tests ------------------------------------------------------------------
function attemptLabel(a, idx) {
  if (a.phase === 'tdd') return 'TDD red (expected)'
  if (a.phase === 'gate') return 'Gate run'
  return `Attempt ${idx}`
}

function PytestOutput({ text }) {
  const lines = String(text).split('\n')
  return (
    <pre className="pytest" tabIndex={0} aria-label="pytest output">
      {lines.map((l, i) => {
        let cls = ''
        if (/^E\s|FAILED|failed|Error\b|^>/.test(l)) cls = 'pt-bad'
        else if (/\bpassed\b|PASSED/.test(l)) cls = 'pt-good'
        else if (/^[=_]{3,}|^_ _/.test(l)) cls = 'pt-rule'
        return (
          <span key={i} className={cls}>
            {l}
            {'\n'}
          </span>
        )
      })}
    </pre>
  )
}

export function TestsTab({ task }) {
  const tests = task.tests
  const attempts = tests?.attempts || []
  if (!tests || (!attempts.length && tests.passed == null)) {
    return isActive(task) ? (
      <Waiting agent="Test Runner" active title="Tests are on the way">
        The Test Author writes failing tests first, then the Test Runner runs pytest and the Coder self-heals failures.
      </Waiting>
    ) : (
      <EmptyState compact icon={CircleDashed} title="No test results" />
    )
  }
  let counter = 0
  const numbered = attempts.map((a) => ({ ...a, label: attemptLabel(a, a.phase === 'tdd' || a.phase === 'gate' ? 0 : ++counter) }))
  const runs = attempts.filter((a) => a.phase !== 'tdd')
  const last = runs[runs.length - 1]
  const green = last ? (last.ok ?? last.failed === 0) : tests.failed === 0
  const selfHealed = typeof tests.selfHealed === 'boolean' ? tests.selfHealed : runs.length > 1 && green
  return (
    <div className="tests">
      <div className="tests-summary">
        <div className={`tests-big tone-${green ? 'good' : 'critical'}`}>
          {green ? <CircleCheck size={22} aria-hidden="true" /> : <XCircle size={22} aria-hidden="true" />}
          <span>
            {tests.passed ?? '—'}/{tests.total ?? '—'}
          </span>
          <span className="tests-big-label">{green ? 'passing' : 'failing'}</span>
        </div>
        <div className="tests-chips">
          {tests.newTests != null && (
            <span className="chip tone-neutral">
              <AgentAvatar agent="Test Author" size={16} /> {tests.newTests} new tests written first
            </span>
          )}
          {selfHealed && (
            <span className="chip tone-good">
              <RotateCw size={12} aria-hidden="true" /> Self-healed
            </span>
          )}
          <span className="chip tone-neutral">{runs.length} test {runs.length === 1 ? 'run' : 'runs'}</span>
        </div>
      </div>

      <ol className="attempts" aria-label="Test attempts">
        {numbered.map((a, i) => {
          const tdd = a.phase === 'tdd'
          const ok = a.ok ?? a.failed === 0
          const tone = tdd ? 'info' : ok ? 'good' : 'critical'
          return (
            <li key={`${a.n}-${i}`} className={`attempt tone-${tone}`}>
              <div className="attempt-head">
                {tdd ? <CircleAlert size={15} aria-hidden="true" /> : ok ? <CircleCheck size={15} aria-hidden="true" /> : <XCircle size={15} aria-hidden="true" />}
                <span className="attempt-label">{a.label}</span>
              </div>
              <div className="attempt-score">
                {a.passed ?? '—'}/{a.total ?? '—'} <span className="muted">passed</span>
              </div>
              {a.summary && <div className="attempt-summary">{a.summary}</div>}
              <div className="attempt-foot">
                {a.by && <AgentAvatar agent={a.by} size={16} />}
                {a.by && <span>{a.by}</span>}
                {a.durationSec != null && <span>· {fmtDuration(a.durationSec)}</span>}
              </div>
            </li>
          )
        })}
      </ol>

      {tests.output && (
        <section>
          <h3 className="sub-title">
            pytest output <span className="sub-note">tail of the last run</span>
          </h3>
          <PytestOutput text={tests.output} />
        </section>
      )}
    </div>
  )
}

// ---- Review -----------------------------------------------------------------
const SEVERITY = {
  critical: { icon: OctagonAlert, tone: 'critical', label: 'Critical' },
  major: { icon: TriangleAlert, tone: 'serious', label: 'Major' },
  minor: { icon: CircleAlert, tone: 'warning', label: 'Minor' },
  info: { icon: Info, tone: 'info', label: 'Info' },
}
const SEV_ORDER = ['critical', 'major', 'minor', 'info']

export function ReviewTab({ task }) {
  const r = task.review
  if (!r) {
    return isActive(task) ? (
      <Waiting agent="Reviewer" active title="Waiting for the AI review">
        The Reviewer scores the diff 0–100 for correctness, security and maintainability.
      </Waiting>
    ) : (
      <EmptyState compact icon={CircleDashed} title="No review" />
    )
  }
  const issues = [...(r.issues || [])].sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity))
  const approve = r.verdict === 'approve'
  return (
    <div className="review">
      <div className="review-head">
        <ScoreRing score={r.score} />
        <div className="review-main">
          <div className="review-chips">
            <span className={`chip tone-${approve ? 'good' : 'warning'}`}>
              {approve ? <CircleCheck size={13} aria-hidden="true" /> : <TriangleAlert size={13} aria-hidden="true" />}
              {approve ? 'Approved by Reviewer' : 'Changes requested'}
            </span>
            <RiskChip risk={r.risk} />
            {r.rounds > 1 && <span className="chip tone-neutral">{r.rounds} review rounds</span>}
          </div>
          {r.summary && (
            <p className="review-summary">
              <RichText text={r.summary} />
            </p>
          )}
        </div>
      </div>
      <h3 className="sub-title">
        Issues <span className="sub-note">{issues.length ? `${issues.length} found` : 'none'}</span>
      </h3>
      {issues.length ? (
        <ul className="issues">
          {issues.map((it, i) => {
            const sev = SEVERITY[it.severity] || SEVERITY.info
            const Icon = sev.icon
            return (
              <li key={i} className="issue">
                <Icon size={16} className={`tone-icon tone-${sev.tone}`} aria-hidden="true" />
                <div>
                  <div className="issue-head">
                    <span className={`chip chip-xs tone-${sev.tone}`}>{sev.label}</span>
                    {it.file && <span className="mono issue-file">{it.file}</span>}
                  </div>
                  <p className="issue-msg">
                    <RichText text={it.message} />
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <EmptyState compact icon={CircleCheck} title="No issues found" />
      )}
    </div>
  )
}

// ---- Live preview -------------------------------------------------------------
export function PreviewTab({ task, project }) {
  const { backend } = useBackend()
  const [nonce, setNonce] = useState(0)
  const [loading, setLoading] = useState(true)
  const url = task.preview?.url
  const srcDoc = useMemo(() => (url ? backend?.previewDoc?.(url) : null), [backend, url, nonce])
  if (!url) {
    return isActive(task) ? (
      <Waiting agent="Deployer" active={task.stages?.preview?.status === 'running'} title="No preview yet">
        The Deployer creates a tagged Cloud Run revision with 0% traffic and a unique URL after the build.
      </Waiting>
    ) : (
      <EmptyState compact icon={AppWindow} title="No live preview">
        This task never reached the preview stage.
      </EmptyState>
    )
  }
  const live = project?.prodRevision && project.prodRevision === task.preview.revision
  const open = () => (backend?.openUrl ? backend.openUrl(url) : window.open(url, '_blank', 'noopener,noreferrer'))
  return (
    <div className="preview">
      <div className="browser">
        <div className="browser-bar">
          <span className="browser-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <div className="browser-url" title={url}>
            <Lock size={12} aria-hidden="true" />
            <span className="browser-host">{hostOf(url)}</span>
          </div>
          <button type="button" className="btn btn-ghost btn-xs btn-icon-only" onClick={() => (setLoading(true), setNonce((n) => n + 1))} aria-label="Reload preview">
            <RotateCw size={14} aria-hidden="true" />
          </button>
          <CopyButton text={url} label="Copy URL" className="btn btn-ghost btn-xs" />
          <button type="button" className="btn btn-xs" onClick={open}>
            <ExternalLink size={13} aria-hidden="true" /> Open in new tab
          </button>
        </div>
        <div className="browser-frame">
          {loading && <div className="browser-loading" aria-hidden="true" />}
          {srcDoc ? (
            <iframe key={nonce} title="Live preview" srcDoc={srcDoc} sandbox="allow-scripts allow-forms" onLoad={() => setLoading(false)} />
          ) : (
            <iframe
              key={nonce}
              title="Live preview"
              src={url}
              sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
              referrerPolicy="no-referrer"
              onLoad={() => setLoading(false)}
            />
          )}
        </div>
      </div>
      <div className="preview-meta">
        <span>
          Revision <span className="mono">{task.preview.revision}</span>
        </span>
        <span>
          Tag <span className="mono">{task.preview.tag}</span>
        </span>
        <span className={`chip chip-xs tone-${live ? 'good' : 'neutral'}`}>{live ? '100% production traffic' : '0% traffic · preview only'}</span>
        <span className="muted">If the page stays blank, open it in a new tab.</span>
      </div>
    </div>
  )
}

// ---- Verify -------------------------------------------------------------------
export function VerifyTab({ task }) {
  const v = task.verify
  if (!v?.checks?.length) {
    return isActive(task) ? (
      <Waiting agent="Verifier" active={task.stages?.verify?.status === 'running'} title="Live verification pending">
        The Verifier generates HTTP smoke tests from the acceptance criteria and runs them against the live preview.
      </Waiting>
    ) : (
      <EmptyState compact icon={CircleDashed} title="No live checks ran" />
    )
  }
  const passed = v.checks.filter((c) => c.ok).length
  const all = passed === v.checks.length
  return (
    <div className="verify">
      <div className={`callout tone-${all ? 'good' : 'critical'}`}>
        {all ? <CircleCheck size={16} aria-hidden="true" /> : <XCircle size={16} aria-hidden="true" />}
        <div>
          <strong>
            {passed}/{v.checks.length} live checks passed
          </strong>{' '}
          against <span className="mono">{task.preview?.url ? hostOf(task.preview.url) : 'the preview'}</span>
        </div>
      </div>
      <div className="table-wrap">
        <table className="data-table verify-table">
          <thead>
            <tr>
              <th scope="col">Result</th>
              <th scope="col">Check</th>
              <th scope="col">Request</th>
              <th scope="col" className="num">
                Status
              </th>
              <th scope="col" className="num">
                Time
              </th>
              <th scope="col">Detail</th>
            </tr>
          </thead>
          <tbody>
            {v.checks.map((c, i) => {
              const expect = c.expectStatus ?? null
              return (
                <tr key={i}>
                  <td>
                    {c.ok ? (
                      <span className="result tone-good">
                        <CircleCheck size={15} aria-hidden="true" /> Pass
                      </span>
                    ) : (
                      <span className="result tone-critical">
                        <XCircle size={15} aria-hidden="true" /> Fail
                      </span>
                    )}
                  </td>
                  <td className="verify-name">{c.name}</td>
                  <td className="nowrap">
                    <span className="method">{c.method || 'GET'}</span> <span className="mono">{c.path}</span>
                  </td>
                  <td className="num nowrap mono">
                    {c.status ?? '—'}
                    {expect != null && expect !== c.status && <span className="muted"> (want {expect})</span>}
                  </td>
                  <td className="num nowrap">{c.ms != null ? `${c.ms} ms` : '—'}</td>
                  <td className="verify-detail">
                    <Linkify text={c.detail} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {v.visual && <VisualCheck visual={v.visual} />}
    </div>
  )
}

function VisualCheck({ visual }) {
  const src = visual.screenshot?.startsWith('http') ? visual.screenshot : `${API_BASE}${visual.screenshot || ''}`
  const tone = !visual.applicable ? 'neutral' : visual.passed ? 'good' : 'warning'
  const label = !visual.applicable ? 'No visible change expected' : visual.passed ? 'UI change confirmed' : 'Needs a human look'
  return (
    <section className="visual-qa" aria-label="Visual QA">
      <div className="visual-qa-head">
        <Eye size={16} aria-hidden="true" />
        <strong>Visual QA</strong>
        <span className="muted">Gemini looked at a screenshot of the live preview</span>
        <span className={`chip chip-xs tone-${tone}`}>{label}</span>
      </div>
      <div className="visual-qa-body">
        {visual.screenshot && (
          <a href={src} target="_blank" rel="noreferrer" className="visual-qa-shot">
            <img src={src} alt="Screenshot of the live preview captured by the Verifier" loading="lazy" />
          </a>
        )}
        <div className="visual-qa-text">
          <p>{visual.summary}</p>
          {visual.observations?.length > 0 && (
            <ul>
              {visual.observations.map((o, i) => (
                <li key={i}>{o}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}

