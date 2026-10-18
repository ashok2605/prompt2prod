import { Braces, GitPullRequest, Hash, Keyboard, Mic, Network, SquareTerminal, Workflow } from 'lucide-react'
import { AgentAvatar } from '../components/AgentAvatar.jsx'
import { ArchitectureDiagram } from '../components/ArchitectureDiagram.jsx'
import { CopyButton } from '../components/Misc.jsx'
import { useBackend } from '../lib/backend.jsx'
import { apiOrigin } from '../lib/api.js'
import { useDocumentTitle } from '../lib/hooks.js'

const ROLE_AGENT = { planner: 'Planner', testAuthor: 'Test Author', test_author: 'Test Author', coder: 'Coder', reviewer: 'Reviewer', verifier: 'Verifier' }

const CHANNELS = [
  { icon: Keyboard, title: 'Dashboard', status: 'live', text: 'Type a change in the Command Center composer. Cmd/Ctrl + Enter ships it.' },
  { icon: Mic, title: 'Voice', status: 'live', text: 'Tap the mic and speak the change — the transcript becomes the prompt (source: voice).' },
  { icon: Braces, title: 'REST / webhook', status: 'live', text: 'POST /api/webhooks/intake with an intake key from any tool, script or bot.' },
  { icon: SquareTerminal, title: 'Developer CLI', status: 'live', text: 'python cli/p2p.py "your change" — submits and streams the crew’s live log in your terminal.' },
  { icon: GitPullRequest, title: 'GitHub Issues', status: 'soon', text: 'Label an issue “prompt2prod” and the crew opens a task, then links the release back.' },
  { icon: Hash, title: 'Slack slash command', status: 'soon', text: '/ship add due dates to tasks — progress threads back into the channel.' },
  { icon: Workflow, title: 'CI hooks', status: 'soon', text: 'When a pipeline goes red, open a fix task with the failing test output attached.' },
]

export function Integrations() {
  useDocumentTitle('Integrations')
  const { config, projects } = useBackend()
  const origin = apiOrigin()
  const projectId = projects[0]?.id || 'acme-tasks'
  const curl = [
    `curl -X POST ${origin}/api/webhooks/intake \\`,
    `  -H "X-Intake-Key: $P2P_INTAKE_KEY" \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '{"prompt":"Add a GET /api/version endpoint returning the app name","projectId":"${projectId}","mode":"approval","requester":"curl"}'`,
  ].join('\n')
  const models = Object.entries(config?.models || {})
  const limits = config?.limits

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Integrations</h1>
          <p className="page-sub">Bring requests from anywhere — every channel lands in the same pipeline and streams into the Command Center.</p>
        </div>
      </div>

      <div className="integrations-top">
        <section className="card intake-card" aria-labelledby="intake-title">
          <div className="card-head">
            <div>
              <h2 id="intake-title" className="card-title">
                REST intake
              </h2>
              <p className="muted small">Create a task from a script, bot or another service. The response is the new task id.</p>
            </div>
            <CopyButton text={curl} label="Copy curl" className="btn btn-sm" />
          </div>
          <pre className="code-block" tabIndex={0} aria-label="curl example">
            <code>{curl}</code>
          </pre>
          <div className="intake-foot">
            <span className="muted small">Response</span>
            <code className="code-inline">{'201 {"id": "k3x9p2"}'}</code>
            <span className="muted small">
              · optional fields: <code className="code-inline">projectId</code> <code className="code-inline">source</code>{' '}
              <code className="code-inline">requester</code>
            </span>
          </div>
        </section>
        <section className="card" aria-labelledby="roster-title">
          <div className="card-head">
            <h2 id="roster-title" className="card-title">
              Model roster
            </h2>
            <span className="muted small">Gemini via Vertex AI</span>
          </div>
          {models.length ? (
            <ul className="roster">
              {models.map(([role, model]) => (
                <li key={role}>
                  <AgentAvatar agent={ROLE_AGENT[role] || role} size={28} />
                  <span className="roster-role">{ROLE_AGENT[role] || role}</span>
                  <span className="mono roster-model">{String(model)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small card-pad">The backend did not report models.</p>
          )}
          {limits && (
            <p className="muted small card-pad roster-limits">
              Rate limits: {limits.perUserPerHour ?? '—'} tasks per user per hour · {limits.perDay ?? '—'} per day
              {config?.version ? ` · API ${config.version}` : ''}
            </p>
          )}
        </section>
      </div>

      <div className="channel-grid">
        {CHANNELS.map((c) => {
          const Icon = c.icon
          return (
            <div key={c.title} className={`card channel${c.status === 'soon' ? ' is-soon' : ''}`}>
              <div className="channel-head">
                <span className="channel-icon" aria-hidden="true">
                  <Icon size={18} />
                </span>
                <h3 className="channel-title">{c.title}</h3>
                <span className={`chip chip-xs tone-${c.status === 'live' ? 'good' : 'neutral'}`}>{c.status === 'live' ? 'Available' : 'Coming soon'}</span>
              </div>
              <p className="muted small">{c.text}</p>
            </div>
          )
        })}
      </div>

      <section className="card arch-card" aria-labelledby="arch-heading">
        <div className="card-head">
          <h2 id="arch-heading" className="card-title">
            <Network size={16} aria-hidden="true" /> Architecture
          </h2>
          <span className="muted small">Google Cloud · asia-south1</span>
        </div>
        <ArchitectureDiagram />
      </section>
    </div>
  )
}
