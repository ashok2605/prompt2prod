// Offline demo backend. Same shapes as docs/SPEC.md (projects, tasks, events)
// and the same method surface as the live backend in firebase.js, so every
// page works unchanged. Seeded with realistic history across the last 14 days;
// new tasks animate through all 10 stages with an event every 0.4–1.5 s.
import { ApiError } from './errors.js'
import { fmtDuration } from './format.js'
import { hashHex } from './mockDiff.js'
import { renderAcmePreview } from './mockPreview.js'
import { FAILED_CSV, REPO_TREE, SCENARIOS, genericScenario, lineCount, materialize, pickScenario, pytestOutput } from './mockScenarios.js'

const GCP_PROJECT = 'project-b7607e7e-cc83-423b-8a1'
const PROJECT_NUMBER = '82783179546'
const REGION = 'asia-south1'
const PROJECT_ID = 'acme-tasks'
const PROD_URL = `https://acme-tasks-${PROJECT_NUMBER}.${REGION}.run.app`
const REGISTRY = `${REGION}-docker.pkg.dev/${GCP_PROJECT}/prompt2prod`
const BASE_REVISION = 'acme-tasks-base'
const BASE_SHA = 'a1b2c3d'
const MODELS = { planner: 'gemini-3.1-pro-preview', coder: 'gemini-3.5-flash', reviewer: 'gemini-3.1-pro-preview' }
// USD per 1M tokens (input, output) — demo figures.
const RATES = { pro: [1.25, 5], flash: [0.15, 0.6] }
const MIN = 60_000
// Seeded history uses realistic stage timings (Cloud Build alone is ~1 min).
const SIM_SCALE = 1.5

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const B36 = '0123456789abcdefghijklmnopqrstuvwxyz'
const newId = () => Array.from({ length: 6 }, (_, i) => B36[i === 0 ? 10 + Math.floor(Math.random() * 26) : Math.floor(Math.random() * 36)]).join('')
const uuid = (seed) => {
  const h = hashHex(seed, 32)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const round1 = (x) => Math.round(x * 10) / 10
const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)))

function diffStat(files) {
  const width = Math.max(...files.map((f) => f.path.length))
  const lines = files.map((f) => {
    const n = f.additions + f.deletions
    const scale = Math.min(1, 40 / Math.max(1, n))
    const plus = '+'.repeat(Math.round(f.additions * scale))
    const minus = '-'.repeat(Math.round(f.deletions * scale))
    return ` ${f.path.padEnd(width)} | ${String(n).padStart(3)} ${plus}${minus}`
  })
  const A = files.reduce((s, f) => s + f.additions, 0)
  const D = files.reduce((s, f) => s + f.deletions, 0)
  lines.push(` ${files.length} files changed, ${A} insertions(+), ${D} deletions(-)`)
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Pipeline script: a list of steps { sim (seconds, for seeded history),
// wait ([min,max] ms, for live playback), run(ctx) }.
// ---------------------------------------------------------------------------
function buildPipeline(task, sc, rand, { heal = true, failAfter = 0 } = {}) {
  const steps = []
  const add = (sim, run, wait) => steps.push({ sim, run, wait })
  const id = task.id
  const total = sc.names.length
  const nNew = sc.newTests.length
  const base = total - nNew
  const files = sc.files
  const A = files.reduce((s, f) => s + f.additions, 0)
  const D = files.reduce((s, f) => s + f.deletions, 0)
  const execution = `prompt2prod-runner-${hashHex(`${id}:exec`, 5)}`
  const jitter = (n) => Math.round(n * (0.85 + rand() * 0.3))
  const codeFiles = files.filter((f) => !f.path.startsWith('tests/'))
  const testFile = files.find((f) => f.path.startsWith('tests/'))

  // 1 · Sandbox -------------------------------------------------------------
  add(1.6, (c) => {
    c.set({ status: 'running', startedAt: c.now() })
    c.startStage('sandbox')
    c.log('Orchestrator', 'info', `Starting Cloud Run Job prompt2prod-runner · execution ${execution}`, `region: ${REGION} · 2 vCPU · 4 GiB · timeout 15m\nimage: ${REGISTRY}/runner:latest`)
  }, [1200, 1800])
  add(2.8, (c) =>
    c.log('Orchestrator', 'tool', `restore_repo("acme-tasks") → ${c.baseSha} (git bundle · 214 KB)`,
      `gsutil cp gs://prompt2prod-${PROJECT_NUMBER}/repos/acme-tasks/main.bundle /workspace\ngit clone --branch main main.bundle acme-tasks\ngit checkout -b task/${id}\nHEAD is now at ${c.baseSha}`))
  add(2.2, (c) => c.log('Orchestrator', 'info', `Workspace ready · Python 3.12.7 · ${base} tests collected at baseline`), [500, 900])
  add(0.7, (c) => {
    c.endStage('sandbox', 'Cloud Run Job')
    c.log('Orchestrator', 'success', `Sandbox ready in ${fmtDuration(c.stageSecs('sandbox'))}`)
  }, [400, 800])

  // 2 · Plan ----------------------------------------------------------------
  add(0.6, (c) => {
    c.startStage('plan')
    c.log('Planner', 'thought', 'Reading the repository to understand the data model, routes and templates…')
  }, [500, 900])
  add(2.0, (c) => c.log('Planner', 'tool', 'list_files(".") → 8 files', REPO_TREE), [500, 900])
  for (const f of [...codeFiles, ...(testFile ? [testFile] : [])]) {
    add(1.4, (c) => c.log('Planner', 'tool', `read_file("${f.path}") → ${lineCount(f.path)} lines`), [400, 800])
  }
  add(6.5, (c) => {
    c.tokens('planner', jitter(14200), jitter(1900))
    c.log('Planner', 'thought', sc.planThought)
  }, [1000, 1500])
  add(4.2, (c) => {
    c.tokens('planner', jitter(2600), jitter(900))
    c.set({
      title: sc.title,
      plan: { summary: sc.summary, steps: sc.steps, files: files.map((f) => f.path), acceptance: sc.acceptance, risk: sc.risk, estimatedHours: sc.estimatedHours },
    })
    c.endStage('plan', `${sc.steps.length} steps · ${files.length} files`)
    c.log('Planner', 'success', `Plan ready: ${sc.steps.length} steps · ${files.length} files · risk ${sc.risk}`,
      `${sc.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\nAcceptance criteria:\n${sc.acceptance.map((a) => `• ${a}`).join('\n')}`)
  }, [900, 1400])

  // 3 · Tests first ---------------------------------------------------------
  const red = sc.newTests.map((n) => `FAILED tests/test_api.py::${n} - ${sc.red?.[n] || 'AssertionError'}`)
  add(0.6, (c) => {
    c.startStage('tests')
    c.log('Test Author', 'thought', `Turning ${sc.acceptance.length} acceptance criteria into failing tests before any implementation (TDD).`)
  }, [500, 900])
  add(4.8, (c) => {
    c.tokens('coder', jitter(9100), jitter(1700))
    c.log('Test Author', 'tool', `write_file("tests/test_api.py") · +${testFile?.additions ?? 0} lines · ${nNew} new tests`, sc.newTestCode)
  }, [900, 1500])
  add(2.4, (c) => c.log('Test Author', 'tool', 'pytest tests/test_api.py', `${red.join('\n')}\n${nNew} failed, ${base} passed in 0.39s`), [600, 1100])
  add(0.8, (c) => {
    c.set({ tests: { passed: base, failed: nNew, total, newTests: nNew, selfHealed: false, output: null,
      attempts: [{ n: 0, phase: 'tdd', by: 'Test Author', ok: false, passed: base, failed: nNew, total, summary: `${nNew} new tests fail as expected (red)`, durationSec: round1(1.2 + rand() * 0.6) }] } })
    c.endStage('tests', `${nNew} new tests`)
    c.log('Test Author', 'success', `Red phase confirmed: ${nNew} new tests fail, ${base} existing pass`)
  }, [400, 800])

  // 4 · Implement -----------------------------------------------------------
  add(0.6, (c) => {
    c.startStage('code')
    c.log('Coder', 'thought', sc.codeThought)
  }, [500, 900])
  for (const f of codeFiles) {
    add(1.3, (c) => c.log('Coder', 'tool', `read_file("${f.path}")`), [400, 700])
    add(4.6, (c) => {
      c.tokens('coder', jitter(7800), jitter(1500))
      c.log('Coder', 'tool', `edit_file("${f.path}") · +${f.additions} −${f.deletions}`, sc.firstHunk[f.path])
    }, [800, 1500])
  }
  add(1.2, (c) => c.log('Coder', 'info', sc.codeNote), [500, 900])
  add(0.8, (c) => {
    c.set({ diff: sc.diff, files })
    c.endStage('code', `${files.length} files · +${A} −${D}`)
    c.log('Coder', 'success', `Implementation complete · ${files.length} files changed · +${A} −${D}`)
  }, [400, 800])

  // 5 · Test & heal ---------------------------------------------------------
  const failing = failAfter ? (sc.heal || []).slice(0, failAfter) : heal ? (sc.heal || []).slice(0, 1) : []
  const pytest = (fail, seconds) => pytestOutput({ names: sc.names, failing: fail, seconds, testFile: sc.testFile, appFile: sc.appFile })
  add(0.6, (c) => {
    c.startStage('test')
    c.log('Test Runner', 'tool', 'pytest · attempt 1/3')
  }, [500, 800])
  for (let k = 0; k < failing.length; k++) {
    const h = failing[k]
    const n = k + 1
    const f = h.failing.length
    add(2.2, (c) => {
      const secs = 1.6 + rand() * 0.9
      const out = pytest(h.failing, secs * 0.22)
      c.pushAttempt({ n, phase: n === 1 ? 'coder' : 'heal', by: 'Test Runner', ok: false, passed: total - f, failed: f, total, summary: `${f} failed: ${h.failing.map((x) => x.name).join(', ')}`, durationSec: round1(secs) }, out)
      c.log('Test Runner', 'error', `Attempt ${n}: ${total - f}/${total} passed · ${f} failed`, out)
    }, [800, 1400])
    if (failAfter && n === failing.length) {
      add(0.8, (c) => {
        const error = `Tests still failing after ${n} attempts: ${h.failing.map((x) => x.name).join(', ')}`
        c.endStage('test', `${total - f}/${total} · ${n} attempts`, 'failed')
        c.set({ status: 'failed', error, finishedAt: c.now() })
        c.finishMetrics()
        c.log('Test Runner', 'error', `Giving up after ${n} attempts — ${f} test${f === 1 ? '' : 's'} still failing`, error)
      })
      add(0.6, (c) => c.log('Orchestrator', 'warn', 'Pipeline stopped at Test & heal — nothing was built or deployed', `Branch task/${id} kept for inspection.`))
      return steps
    }
    for (const fx of h.fixes) {
      add(3.2, (c) => {
        c.tokens('coder', jitter(6400), jitter(900))
        c.log('Coder', 'thought', fx.thought)
      }, [1000, 1500])
      add(1.6, (c) => c.log('Coder', 'tool', `edit_file("${fx.file}") · ${fx.change}`, fx.patch), [500, 1000])
    }
    add(0.6, (c) => c.log('Test Runner', 'tool', `pytest · attempt ${n + 1}/3`), [400, 700])
  }
  add(2.0, (c) => {
    const n = failing.length + 1
    const secs = 1.5 + rand() * 0.8
    const out = pytest([], secs * 0.22)
    c.pushAttempt({ n, phase: n === 1 ? 'coder' : 'heal', by: 'Test Runner', ok: true, passed: total, failed: 0, total, summary: 'all tests passed', durationSec: round1(secs) }, out)
    c.set({ tests: { ...c.task.tests, selfHealed: n > 1 } })
    c.endStage('test', n > 1 ? `${total}/${total} · self-healed` : `${total}/${total} passed`)
    c.log('Test Runner', 'success', n > 1 ? `Attempt ${n}: ${total}/${total} passed · self-healed after ${n - 1} fix${n > 2 ? 'es' : ''}` : `${total}/${total} passed on the first attempt`, out)
  }, [800, 1400])

  // 6 · AI review -----------------------------------------------------------
  add(0.6, (c) => {
    c.startStage('review')
    c.log('Reviewer', 'thought', `Reviewing the full diff (${files.length} files, +${A} −${D}) for correctness, security and maintainability…`)
  }, [500, 900])
  add(1.5, (c) => c.log('Reviewer', 'tool', 'git diff --stat main...HEAD', diffStat(files)), [500, 900])
  add(5.5, (c) => {
    c.tokens('reviewer', jitter(11800), jitter(1200))
    c.log('Reviewer', 'info', sc.reviewNote)
  }, [1000, 1500])
  for (const issue of sc.review.issues) {
    add(1.0, (c) => c.log('Reviewer', ['major', 'critical'].includes(issue.severity) ? 'warn' : 'info', `${issue.severity} · ${issue.file}: ${issue.message}`), [500, 900])
  }
  add(0.9, (c) => {
    c.set({ review: sc.review })
    c.endStage('review', `${sc.review.score}/100 · ${sc.review.risk} risk`)
    c.log('Reviewer', 'success', `Score ${sc.review.score}/100 · risk ${sc.review.risk} · verdict: approve`, sc.review.summary)
  }, [500, 900])

  // 7 · Build ---------------------------------------------------------------
  const sha = hashHex(`${id}:commit`)
  const image = `${REGISTRY}/acme-tasks:${sha}`
  const buildId = uuid(`${id}:build`)
  add(0.6, (c) => {
    c.startStage('build')
    c.set({ commit: { sha, branch: `task/${id}`, message: sc.commit, baseSha: c.baseSha } })
    c.log('Builder', 'tool', `git commit -m "${sc.commit}" → ${sha}`, `[task/${id} ${sha}] ${sc.commit}\n ${files.length} files changed, ${A} insertions(+), ${D} deletions(-)`)
  }, [500, 900])
  add(1.6, (c) => c.log('Builder', 'tool', `gcloud builds submit --region=${REGION} --tag …/acme-tasks:${sha}`,
    `gcloud builds submit /workspace/acme-tasks \\\n  --project=${GCP_PROJECT} \\\n  --region=${REGION} \\\n  --tag=${image}\nCreated [https://cloudbuild.googleapis.com/v1/projects/${GCP_PROJECT}/locations/${REGION}/builds/${buildId}]`), [500, 900])
  add(9.5, (c) => c.log('Builder', 'info', 'Step 1/4 · FROM python:3.12-slim (cached)'), [700, 1200])
  add(11, (c) => c.log('Builder', 'info', 'Step 2/4 · RUN pip install --no-cache-dir -r requirements.txt (cached layer)'), [700, 1200])
  add(8.5, (c) => c.log('Builder', 'info', 'Step 3/4 · COPY . /app'), [500, 900])
  add(7.5, (c) => c.log('Builder', 'info', `Step 4/4 · pushing acme-tasks:${sha} to Artifact Registry`), [800, 1400])
  add(3.2, (c) => {
    const secs = Math.round(c.stageSecs('build'))
    c.set({ build: { id: buildId, image, durationSec: secs, logUrl: `https://console.cloud.google.com/cloud-build/builds;region=${REGION}/${buildId}?project=${GCP_PROJECT}` } })
    c.endStage('build', `${fmtDuration(secs)} · ${sha}`)
    c.log('Builder', 'success', `Image built in ${fmtDuration(secs)} · digest sha256:${hashHex(`${id}:digest`, 12)}…`, image)
  }, [600, 1000])

  // 8 · Preview -------------------------------------------------------------
  const tag = `t-${id}`
  const revision = `acme-tasks-${id}`
  const url = `https://${tag}---acme-tasks-${PROJECT_NUMBER}.${REGION}.run.app`
  add(0.6, (c) => {
    c.startStage('preview')
    c.log('Deployer', 'tool', `gcloud run deploy acme-tasks --image …:${sha} --tag ${tag} --no-traffic`,
      `gcloud run deploy acme-tasks \\\n  --image=${image} \\\n  --region=${REGION} \\\n  --tag=${tag} \\\n  --no-traffic`)
  }, [500, 900])
  add(9, (c) => c.log('Deployer', 'info', `Revision ${revision} created · serving 0% of production traffic`), [900, 1500])
  add(5.5, (c) => c.log('Deployer', 'info', 'Startup probe passed · GET /healthz → 200'), [600, 1000])
  add(1.0, (c) => {
    c.set({ preview: { url, revision, tag } })
    c.endStage('preview', `${tag} · 0% traffic`)
    c.log('Deployer', 'success', `Preview live at ${url}`)
  }, [500, 900])

  // 9 · Verify live ---------------------------------------------------------
  add(0.6, (c) => {
    c.startStage('verify')
    c.log('Verifier', 'thought', 'Generating HTTP smoke tests from the acceptance criteria, then probing the live preview…')
  }, [500, 900])
  add(3.2, (c) => {
    c.tokens('coder', jitter(4300), jitter(800))
    c.log('Verifier', 'tool', `generate_checks() → ${sc.verify.length} checks`, sc.verify.map((v, i) => `${i + 1}. ${v.method} ${v.path} — ${v.name}`).join('\n'))
  }, [900, 1400])
  for (const v of sc.verify) {
    add(1.2, (c) => c.log('Verifier', 'success', `${v.method} ${v.path} → ${v.status} · ${v.ms} ms`, `${v.name}\n${v.detail}`), [500, 1000])
  }
  add(0.8, (c) => {
    c.set({ verify: { passed: true, checks: sc.verify.map((v) => ({ ...v, expectStatus: v.status, ok: true })) } })
    c.endStage('verify', `${sc.verify.length}/${sc.verify.length} passed`)
    c.log('Verifier', 'success', `${sc.verify.length}/${sc.verify.length} live checks passed on the preview`)
  }, [400, 800])

  // 10 · Release gate -------------------------------------------------------
  add(0.6, (c) => {
    c.startStage('release')
    c.log('Release Manager', 'info', `Gates: tests ${total}/${total} ✓ · review ${sc.review.score}/100 ✓ · live checks ${sc.verify.length}/${sc.verify.length} ✓`)
  }, [500, 900])
  if (task.mode === 'approval') {
    add(0.6, (c) => {
      c.waitStage('release', 'awaiting approval')
      c.set({ status: 'awaiting_approval' })
      c.snapshotMetrics()
      c.log('Release Manager', 'warn', 'Approval mode — waiting for a human to approve the release',
        `Preview: ${url}\nApprove to shift 100% of production traffic to ${revision}.`)
    }, [500, 900])
  } else {
    add(0.5, (c) => c.log('Release Manager', 'info', `Autopilot: every gate passed — promoting ${revision}`), [400, 800])
    steps.push(...buildRelease('autopilot'))
  }
  return steps
}

function buildRelease(by) {
  const steps = []
  const add = (sim, run, wait) => steps.push({ sim, run, wait })
  if (by !== 'autopilot') {
    add(0.4, (c) => {
      c.resumeStage('release')
      c.set({ status: 'running' })
      c.log('Release Manager', 'info', `Approved by ${by} — promoting ${c.task.preview?.revision}`)
    }, [150, 300])
  }
  add(1.2, (c) => c.log('Release Manager', 'tool', `gcloud run services update-traffic acme-tasks --to-tags ${c.task.preview?.tag}=100`,
    `gcloud run services update-traffic acme-tasks \\\n  --region=${REGION} \\\n  --to-tags=${c.task.preview?.tag}=100`), by === 'autopilot' ? [500, 900] : [350, 600])
  add(3.0, (c) => c.log('Release Manager', 'info', `Traffic shifted: ${c.task.preview?.revision} 100% · ${c.project().prodRevision} 0% (kept for rollback)`), by === 'autopilot' ? [600, 1000] : [350, 600])
  add(0.6, (c) => {
    const prev = c.project().prodRevision
    const now = c.now()
    c.set({
      release: { url: c.project().prodUrl, revision: c.task.preview?.revision, promotedAt: now, promotedBy: by, previousRevision: prev },
      status: 'deployed',
      stage: 'done',
      finishedAt: now,
    })
    c.endStage('release', by === 'autopilot' ? 'autopilot · 100%' : `approved by ${by}`)
    c.promote(by)
    c.finishMetrics()
    c.log('Release Manager', 'success', `Released to production · ${c.project().prodUrl}`, `revision ${c.task.preview?.revision} · commit ${c.task.commit?.sha} · previous ${prev}`, 'release')
  }, by === 'autopilot' ? [400, 800] : [250, 450])
  return steps
}

// Historical demo tasks, oldest first (they mutate project state in order).
const SEEDS = [
  { id: 'k3x9p2', key: 'priority', day: 13, at: [10, 12], mode: 'autopilot', source: 'dashboard', by: 'Ashok', heal: true },
  { id: 'q1z7hd', generic: true, day: 11, at: [11, 2], mode: 'autopilot', source: 'api', by: 'Maya', heal: false,
    prompt: 'Add an estimate field to tasks so we can size work in planning' },
  { id: 'm7q2zd', key: 'stats', day: 11, at: [15, 41], mode: 'autopilot', source: 'voice', by: 'Ashok', heal: true,
    prompt: 'add a stats endpoint that returns total done and completion percentage and show a progress bar at the top of the page' },
  { id: 'c4v8tn', key: 'validation', day: 10, at: [11, 5], mode: 'autopilot', source: 'api', by: 'Maya', heal: false },
  { id: 'r2d7wq', key: 'duedates', day: 8, at: [14, 20], mode: 'autopilot', source: 'dashboard', by: 'Priya', heal: true, rollback: { after: 23, by: 'Priya' } },
  { id: 'h5n3la', key: 'darkmode', day: 6, at: [9, 52], mode: 'approval', source: 'dashboard', by: 'Ashok', heal: false, approve: { after: 9, by: 'Priya' } },
  { id: 'x9f1eb', key: 'csv_failed', day: 5, at: [16, 30], mode: 'autopilot', source: 'webhook', by: 'GitHub intake', fail: true,
    prompt: 'Add CSV export of all tasks at /export.csv (from GitHub issue #42: "Finance needs a spreadsheet export")' },
  { id: 'p6s4yu', key: 'avatars', day: 4, at: [12, 10], mode: 'approval', source: 'voice', by: 'Sam', heal: false, reject: { after: 7, by: 'Ashok' },
    prompt: 'replace the at assignee text with colored avatar initials' },
  { id: 'w8j2kc', key: 'search', day: 3, at: [10, 45], mode: 'autopilot', source: 'webhook', by: 'Maya', heal: true },
  { id: 'f8k2wm', generic: true, day: 3, at: [15, 34], mode: 'autopilot', source: 'dashboard', by: 'Priya', heal: true,
    prompt: 'Add tags to tasks so people can group related work' },
  { id: 'b3t6gm', key: 'assignees', day: 1, at: [17, 5], mode: 'autopilot', source: 'voice', by: 'Ashok', heal: false,
    prompt: 'show how many open tasks each person has in the header' },
  { id: 'v6c1np', generic: true, minutesAgo: 318, mode: 'autopilot', source: 'voice', by: 'Ashok', heal: false,
    prompt: 'add a notes field to tasks for extra context' },
  { id: 'n5r8vz', key: 'shortcut', minutesAgo: 134, mode: 'approval', source: 'dashboard', by: 'Sam', heal: true, awaiting: true },
]

// ---------------------------------------------------------------------------
class MockBackend {
  constructor({ speed = 1 } = {}) {
    this.mode = 'mock'
    this.speed = Math.min(8, Math.max(0.25, Number(speed) || 1))
    this.user = { uid: 'demo-user', isAnonymous: true }
    this.connection = 'demo'
    this.identity = 'You'
    this.projects = new Map()
    this.prodStack = new Map()
    this.tasks = new Map()
    this.events = new Map()
    this.scenarios = new Map()
    this.runs = new Map()
    this.subs = { projects: new Set(), tasks: new Set(), task: new Map(), events: new Map() }
    this.dirty = { projects: false, tasks: new Set(), events: new Set() }
    this.flushQueued = false
    this.seed()
    this.config = {
      firebase: null,
      projects: this.projectList(),
      limits: { perUserPerHour: 12, perDay: 120 },
      models: MODELS,
      version: '1.0.0-demo',
    }
  }

  // ---- identity ------------------------------------------------------------
  setIdentity(name) {
    this.identity = String(name || '').trim() || 'You'
  }
  onAuthChange() {
    return () => {}
  }
  onConnectionChange() {
    return () => {}
  }

  // ---- subscriptions -------------------------------------------------------
  projectList() {
    return [...this.projects.values()].map(clone)
  }
  taskList() {
    return [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 100).map(clone)
  }
  subscribeProjects(cb) {
    this.subs.projects.add(cb)
    queueMicrotask(() => this.subs.projects.has(cb) && cb(this.projectList()))
    return () => this.subs.projects.delete(cb)
  }
  subscribeTasks(cb) {
    this.subs.tasks.add(cb)
    queueMicrotask(() => this.subs.tasks.has(cb) && cb(this.taskList()))
    return () => this.subs.tasks.delete(cb)
  }
  subscribeTask(id, cb) {
    if (!this.subs.task.has(id)) this.subs.task.set(id, new Set())
    const set = this.subs.task.get(id)
    set.add(cb)
    queueMicrotask(() => set.has(cb) && cb(this.tasks.has(id) ? clone(this.tasks.get(id)) : null))
    return () => set.delete(cb)
  }
  subscribeEvents(id, cb) {
    if (!this.subs.events.has(id)) this.subs.events.set(id, new Set())
    const set = this.subs.events.get(id)
    set.add(cb)
    queueMicrotask(() => set.has(cb) && cb(clone(this.events.get(id) || [])))
    return () => set.delete(cb)
  }
  touch({ task, events, projects } = {}) {
    if (task) this.dirty.tasks.add(task)
    if (events) this.dirty.events.add(events)
    if (projects) this.dirty.projects = true
    if (this.flushQueued) return
    this.flushQueued = true
    queueMicrotask(() => this.flush())
  }
  flush() {
    this.flushQueued = false
    const { tasks, events, projects } = this.dirty
    this.dirty = { projects: false, tasks: new Set(), events: new Set() }
    if (projects && this.subs.projects.size) {
      const list = this.projectList()
      this.subs.projects.forEach((cb) => cb(list))
    }
    if (tasks.size && this.subs.tasks.size) {
      const list = this.taskList()
      this.subs.tasks.forEach((cb) => cb(list))
    }
    for (const id of tasks) this.subs.task.get(id)?.forEach((cb) => cb(clone(this.tasks.get(id))))
    for (const id of events) this.subs.events.get(id)?.forEach((cb) => cb(clone(this.events.get(id) || [])))
  }

  // ---- engine --------------------------------------------------------------
  newTask({ id, projectId = PROJECT_ID, prompt, mode, source, name, createdAt }) {
    const task = {
      id,
      projectId,
      prompt,
      title: null,
      mode: mode === 'approval' ? 'approval' : 'autopilot',
      source: source || 'dashboard',
      requestedBy: { uid: name === this.identity ? this.user.uid : `demo-${String(name).toLowerCase().replace(/\W+/g, '-')}`, name },
      status: 'queued',
      stage: 'queued',
      stages: {},
      plan: null,
      diff: null,
      files: [],
      tests: null,
      review: null,
      commit: null,
      build: null,
      preview: null,
      verify: null,
      release: null,
      metrics: { llmCalls: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, durationSec: null, leadTimeSec: null, models: {} },
      error: null,
      createdAt,
      startedAt: null,
      finishedAt: null,
      updatedAt: createdAt,
    }
    this.tasks.set(id, task)
    this.events.set(id, [])
    return task
  }

  ctx(task, clock) {
    const self = this
    const baseSha = this.projects.get(task.projectId)?.prodCommit || BASE_SHA
    const bump = (t) => {
      t.updatedAt = clock.now()
      self.touch({ task: t.id })
    }
    return {
      task,
      baseSha,
      now: () => clock.now(),
      project: () => self.projects.get(task.projectId),
      set(patch) {
        Object.assign(task, patch)
        bump(task)
      },
      log(agent, kind, message, detail, stage) {
        const list = self.events.get(task.id)
        const seq = list.length + 1
        const ev = { id: `e${String(seq).padStart(4, '0')}`, seq, ts: clock.now(), stage: stage || task.stage, agent, kind, message }
        if (detail) ev.detail = detail
        list.push(ev)
        self.touch({ events: task.id })
      },
      startStage(key) {
        task.stages = { ...task.stages, [key]: { status: 'running', startedAt: clock.now() } }
        task.stage = key
        bump(task)
      },
      endStage(key, summary, status = 'done') {
        task.stages = { ...task.stages, [key]: { ...task.stages[key], status, endedAt: clock.now(), summary } }
        bump(task)
      },
      waitStage(key, summary) {
        task.stages = { ...task.stages, [key]: { ...task.stages[key], status: 'waiting', summary } }
        bump(task)
      },
      resumeStage(key) {
        task.stages = { ...task.stages, [key]: { ...task.stages[key], status: 'running', summary: null } }
        bump(task)
      },
      stageSecs(key) {
        const s = task.stages[key]
        return s?.startedAt ? ((s.endedAt ?? clock.now()) - s.startedAt) / 1000 : 0
      },
      tokens(role, tin, tout) {
        const model = MODELS[role] || MODELS.coder
        const [rin, rout] = model.includes('pro') ? RATES.pro : RATES.flash
        const m = task.metrics
        task.metrics = {
          ...m,
          llmCalls: m.llmCalls + 1,
          tokensIn: m.tokensIn + tin,
          tokensOut: m.tokensOut + tout,
          costUsd: Math.round((m.costUsd + (tin * rin + tout * rout) / 1e6) * 1e5) / 1e5,
          models: { ...m.models, [role]: model },
        }
        bump(task)
      },
      pushAttempt(attempt, output) {
        const t = task.tests || { newTests: 0, attempts: [] }
        task.tests = { ...t, attempts: [...(t.attempts || []), attempt], passed: attempt.passed, failed: attempt.failed, total: attempt.total, output }
        bump(task)
      },
      snapshotMetrics() {
        task.metrics = { ...task.metrics, durationSec: Math.round((clock.now() - (task.startedAt ?? task.createdAt)) / 1000) }
        bump(task)
      },
      finishMetrics() {
        const end = task.finishedAt ?? clock.now()
        const lead = task.release?.promotedAt ? Math.round((task.release.promotedAt - task.createdAt) / 1000) : null
        task.metrics = { ...task.metrics, durationSec: Math.round((end - (task.startedAt ?? task.createdAt)) / 1000), leadTimeSec: lead }
        bump(task)
      },
      promote(by) {
        self.promote(task, by, clock.now())
      },
    }
  }

  /** Run steps instantly on a simulated clock (seeded history). */
  simulate(task, steps, clock, rand) {
    const c = this.ctx(task, clock)
    for (const s of steps) {
      clock.t += s.sim * 1000 * SIM_SCALE * (0.85 + rand() * 0.3)
      s.run(c)
    }
  }

  /** Play steps in real time (live demo); resolves when finished. */
  play(task, steps) {
    const clock = { now: () => Date.now() }
    const c = this.ctx(task, clock)
    return new Promise((resolve) => {
      const run = { timer: null, cancelled: false, resolve }
      this.runs.set(task.id, run)
      let i = 0
      const next = () => {
        if (run.cancelled) return resolve(false)
        if (i >= steps.length) {
          this.runs.delete(task.id)
          return resolve(true)
        }
        const step = steps[i++]
        const [lo, hi] = step.wait || [400, 1500]
        run.timer = setTimeout(() => {
          if (run.cancelled) return resolve(false)
          try {
            step.run(c)
          } catch (err) {
            console.error('[mock] step failed', err)
          }
          next()
        }, (lo + Math.random() * (hi - lo)) / this.speed)
      }
      next()
    })
  }

  stop(id) {
    const run = this.runs.get(id)
    if (run) {
      run.cancelled = true
      clearTimeout(run.timer)
      this.runs.delete(id)
    }
  }

  promote(task, by, at) {
    const p = this.projects.get(task.projectId)
    if (!p) return
    this.prodStack.get(p.id).push({ revision: p.prodRevision, commit: p.prodCommit, taskId: p.prodTaskId })
    p.prodRevision = task.preview?.revision
    p.prodCommit = task.commit?.sha
    p.prodTaskId = task.id
    this.pushRelease(p, { taskId: task.id, title: task.title || task.prompt, revision: p.prodRevision, commit: p.prodCommit, url: p.prodUrl, at, by, kind: 'release' })
  }

  pushRelease(p, entry) {
    p.releases = [...(p.releases || []), entry].slice(-30)
    p.updatedAt = entry.at
    this.touch({ projects: true })
  }

  applyRollback(task, by, at) {
    const p = this.projects.get(task.projectId)
    if (!p || p.prodTaskId !== task.id) throw new ApiError(409, 'Only the change currently in production can be rolled back.')
    const prev = this.prodStack.get(p.id).pop() || { revision: BASE_REVISION, commit: BASE_SHA, taskId: null }
    p.prodRevision = prev.revision
    p.prodCommit = prev.commit
    p.prodTaskId = prev.taskId
    this.pushRelease(p, { taskId: task.id, title: `Rolled back: ${task.title || task.prompt}`, revision: prev.revision, commit: prev.commit, url: p.prodUrl, at, by, kind: 'rollback' })
    const clock = { now: () => at }
    const c = this.ctx(task, clock)
    c.set({ status: 'rolled_back' })
    c.log('Release Manager', 'warn', `Rolled back by ${by} — production restored to ${prev.revision}`,
      `gcloud run services update-traffic acme-tasks --to-revisions=${prev.revision}=100\nRevision ${task.preview?.revision} kept (0% traffic) for inspection.`, 'release')
    return { url: p.prodUrl, revision: prev.revision, commit: prev.commit, at }
  }

  applyReject(task, by, at) {
    const clock = { now: () => at }
    const c = this.ctx(task, clock)
    c.endStage('release', `rejected by ${by}`, 'skipped')
    c.set({ status: 'rejected', finishedAt: at })
    c.log('Release Manager', 'warn', `Rejected by ${by} — production unchanged`, `Preview revision ${task.preview?.revision} will be cleaned up.`, 'release')
  }

  seed() {
    const now = Date.now()
    const today = new Date(now)
    const origin = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 14, 9, 0).getTime()
    this.projects.set(PROJECT_ID, {
      id: PROJECT_ID,
      name: 'Acme Tasks',
      description: 'Team task tracker — Flask web app + REST API',
      stack: 'Python 3.12 · Flask · pytest',
      service: 'acme-tasks',
      region: REGION,
      prodUrl: PROD_URL,
      prodRevision: BASE_REVISION,
      prodCommit: BASE_SHA,
      prodTaskId: null,
      releases: [{ taskId: null, title: 'Baseline · Acme Tasks v1.0', revision: BASE_REVISION, commit: BASE_SHA, url: PROD_URL, at: origin, by: 'system', kind: 'reset' }],
      updatedAt: origin,
    })
    this.prodStack.set(PROJECT_ID, [])

    const rand = mulberry32(20261018)
    for (const def of SEEDS) {
      const raw = def.generic ? genericScenario(def.prompt) : def.key === 'csv_failed' ? FAILED_CSV : SCENARIOS.find((s) => s.key === def.key)
      const sc = materialize(raw)
      const createdAt = def.minutesAgo
        ? now - def.minutesAgo * MIN
        : new Date(today.getFullYear(), today.getMonth(), today.getDate() - def.day, def.at[0], def.at[1], Math.floor(rand() * 50)).getTime()
      const task = this.newTask({ id: def.id, prompt: def.prompt || raw.prompt, mode: def.mode, source: def.source, name: def.by, createdAt })
      this.scenarios.set(task.id, sc)
      const clock = { t: createdAt, now() { return this.t } }
      this.simulate(task, buildPipeline(task, sc, rand, { heal: def.heal, failAfter: def.fail ? 3 : 0 }), clock, rand)
      if (def.approve) {
        clock.t += def.approve.after * MIN + rand() * 40_000
        this.simulate(task, buildRelease(def.approve.by), clock, rand)
      }
      if (def.reject) this.applyReject(task, def.reject.by, clock.t + def.reject.after * MIN)
      if (def.rollback) {
        const releasedAt = task.release?.promotedAt ?? clock.t
        this.applyRollback(task, def.rollback.by, releasedAt + def.rollback.after * MIN + Math.floor(rand() * 50_000))
      }
    }
  }

  // ---- REST-equivalent actions ----------------------------------------------
  async createTask({ projectId, prompt, mode, source, requesterName }) {
    await sleep(260)
    const text = String(prompt || '').trim()
    if (text.length < 4) throw new ApiError(422, 'Describe the change in a few words first.')
    if (text.length > 4000) throw new ApiError(422, 'Prompt is too long (4,000 characters max).')
    if (projectId && !this.projects.has(projectId)) throw new ApiError(404, `Unknown project ${projectId}`)
    if (requesterName) this.setIdentity(requesterName)
    let id = newId()
    while (this.tasks.has(id)) id = newId()
    const task = this.newTask({ id, projectId: projectId || PROJECT_ID, prompt: text, mode, source, name: this.identity, createdAt: Date.now() })
    const sc = materialize(pickScenario(text))
    this.scenarios.set(id, sc)
    this.touch({ task: id, events: id })
    this.play(task, buildPipeline(task, sc, Math.random, { heal: true }))
    return { id }
  }

  requireTask(id) {
    const task = this.tasks.get(id)
    if (!task) throw new ApiError(404, `Task ${id} not found`)
    return task
  }

  async approve(id, requesterName) {
    await sleep(200)
    const task = this.requireTask(id)
    if (task.status !== 'awaiting_approval') throw new ApiError(409, 'This task is not waiting for approval.')
    if (requesterName) this.setIdentity(requesterName)
    await this.play(task, buildRelease(this.identity))
    return { ok: true, release: clone(task.release) }
  }

  async reject(id, requesterName) {
    await sleep(250)
    const task = this.requireTask(id)
    if (task.status !== 'awaiting_approval') throw new ApiError(409, 'This task is not waiting for approval.')
    if (requesterName) this.setIdentity(requesterName)
    this.applyReject(task, this.identity, Date.now())
    return { ok: true }
  }

  async rollback(id, requesterName) {
    await sleep(700)
    const task = this.requireTask(id)
    if (task.status !== 'deployed') throw new ApiError(409, 'Only deployed tasks can be rolled back.')
    if (requesterName) this.setIdentity(requesterName)
    const release = this.applyRollback(task, this.identity, Date.now())
    return { ok: true, release }
  }

  async retry(id, requesterName) {
    const task = this.requireTask(id)
    return this.createTask({ projectId: task.projectId, prompt: task.prompt, mode: task.mode, source: 'dashboard', requesterName })
  }

  async cancel(id, requesterName) {
    await sleep(200)
    const task = this.requireTask(id)
    if (task.status !== 'queued') throw new ApiError(409, 'Only queued tasks can be cancelled.')
    if (requesterName) this.setIdentity(requesterName)
    this.stop(id)
    const c = this.ctx(task, { now: () => Date.now() })
    c.set({ status: 'cancelled', finishedAt: Date.now() })
    c.log('Orchestrator', 'warn', `Cancelled by ${this.identity} before a sandbox started`)
    return { ok: true }
  }

  async resetProject(projectId, requesterName) {
    await sleep(600)
    const p = this.projects.get(projectId)
    if (!p) throw new ApiError(404, `Unknown project ${projectId}`)
    if (requesterName) this.setIdentity(requesterName)
    p.prodRevision = BASE_REVISION
    p.prodCommit = BASE_SHA
    p.prodTaskId = null
    this.prodStack.set(p.id, [])
    this.pushRelease(p, { taskId: null, title: 'Reset to baseline', revision: BASE_REVISION, commit: BASE_SHA, url: p.prodUrl, at: Date.now(), by: this.identity, kind: 'reset' })
    return { ok: true }
  }

  // ---- demo-only helpers -----------------------------------------------------
  /** HTML for a preview/production URL so the iframe shows a believable app. */
  previewDoc(url) {
    if (!url) return null
    for (const p of this.projects.values()) {
      if (url === p.prodUrl) {
        const sc = p.prodTaskId ? this.scenarios.get(p.prodTaskId) : null
        return renderAcmePreview(sc?.preview || {})
      }
    }
    for (const t of this.tasks.values()) {
      if (t.preview?.url === url) return renderAcmePreview(this.scenarios.get(t.id)?.preview || {})
    }
    return null
  }

  openUrl(url) {
    const html = this.previewDoc(url)
    if (!html) return window.open(url, '_blank', 'noopener,noreferrer')
    const blob = new Blob([html], { type: 'text/html' })
    const href = URL.createObjectURL(blob)
    window.open(href, '_blank', 'noopener,noreferrer')
    setTimeout(() => URL.revokeObjectURL(href), 60_000)
  }
}

export function createMockBackend(options) {
  return new MockBackend(options)
}
