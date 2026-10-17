// Inline SVG architecture diagram. Colours come from CSS tokens so it reads
// correctly in both themes.
import { Bot, Box, Cloud, Database, Flame, Hammer, Monitor, Sparkles } from 'lucide-react'

function Node({ x, y, w, h, title, sub, icon: Icon, tone, children }) {
  return (
    <g className={`arch-node tone-${tone}`} transform={`translate(${x} ${y})`}>
      <rect className="arch-box" width={w} height={h} rx="12" />
      <rect className="arch-stripe" x="0" y="12" width="3" height={h - 24} rx="1.5" />
      <g transform="translate(14 16)">
        <rect className="arch-icon-bg" width="28" height="28" rx="8" />
        <Icon x={6} y={6} width={16} height={16} className="arch-icon" strokeWidth={2} />
      </g>
      <text className="arch-title" x="51" y="27">
        {title}
      </text>
      {sub && (
        <text className="arch-sub" x="51" y="44">
          {sub}
        </text>
      )}
      {children}
    </g>
  )
}

function Edge({ d, label, lx, ly, both = false, anchor = 'middle' }) {
  return (
    <g className="arch-edge">
      <path d={d} markerEnd="url(#arch-arrow)" markerStart={both ? 'url(#arch-arrow-start)' : undefined} />
      {label && (
        <text x={lx} y={ly} textAnchor={anchor} className="arch-edge-label">
          {label}
        </text>
      )}
    </g>
  )
}

const AGENTS = ['Planner', 'Test Author', 'Coder', 'Reviewer', 'Verifier']

export function ArchitectureDiagram() {
  return (
    <div className="arch-wrap">
      <svg className="arch" viewBox="0 0 1100 470" role="img" aria-labelledby="arch-title arch-desc">
        <title id="arch-title">Prompt2Prod architecture</title>
        <desc id="arch-desc">
          A developer sends a request from the dashboard, voice or the REST API to the FastAPI service on Cloud Run. It stores the task in Firestore and
          starts a Cloud Run Job sandbox where Google ADK agents (Planner, Test Author, Coder, Reviewer, Verifier) run on Gemini via Vertex AI. The job
          streams live events to Firestore, which the dashboard receives through the Firebase realtime SDK. The job builds a container with Cloud Build,
          pushes it to Artifact Registry and deploys a tagged preview revision of the target Cloud Run app, verifies it, then shifts production traffic.
        </desc>
        <defs>
          <marker id="arch-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="arch-arrowhead" />
          </marker>
          <marker id="arch-arrow-start" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="arch-arrowhead" />
          </marker>
        </defs>

        {/* Row 1 */}
        <Node x={20} y={30} w={190} h={128} title="Developer" sub="any channel" icon={Monitor} tone="slate">
          {['Dashboard', 'Voice', 'REST · Webhook'].map((t, i) => (
            <g key={t} transform={`translate(16 ${66 + i * 19})`}>
              <circle cx="4" cy="-4" r="2.5" className="arch-dot" />
              <text x="14" y="0" className="arch-item">
                {t}
              </text>
            </g>
          ))}
        </Node>
        <Node x={270} y={30} w={210} h={128} title="Cloud Run API" sub="FastAPI · prompt2prod" icon={Cloud} tone="blue">
          <text x="16" y="86" className="arch-item">REST + intake webhooks</text>
          <text x="16" y="105" className="arch-item">serves this dashboard</text>
          <text x="16" y="124" className="arch-item">rate limits · auth</text>
        </Node>
        <Node x={540} y={20} w={330} h={196} title="Cloud Run Job sandbox" sub="prompt2prod-runner · one per task" icon={Bot} tone="violet">
          {AGENTS.map((a, i) => {
            const col = i % 3
            const row = Math.floor(i / 3)
            return (
              <g key={a} transform={`translate(${16 + col * 102} ${66 + row * 38})`}>
                <rect className="arch-chip" width="94" height="28" rx="14" />
                <text x="47" y="18.5" textAnchor="middle" className="arch-chip-text">
                  {a}
                </text>
              </g>
            )
          })}
          <text x="16" y="168" className="arch-item">Google ADK agents · tests-first · self-healing</text>
          <text x="16" y="186" className="arch-item arch-muted">isolated container · repo from git bundle</text>
        </Node>
        <Node x={930} y={40} w={150} h={118} title="Vertex AI" sub="Gemini models" icon={Sparkles} tone="pink">
          <text x="16" y="86" className="arch-item">Pro · planning</text>
          <text x="16" y="105" className="arch-item">Flash · coding</text>
          <text x="16" y="124" className="arch-item">location: global</text>
        </Node>

        {/* Row 2 */}
        <Node x={20} y={300} w={190} h={110} title="Firebase" sub="Auth + realtime SDK" icon={Flame} tone="amber">
          <text x="16" y="84" className="arch-item">anonymous sign-in</text>
          <text x="16" y="102" className="arch-item">live snapshots → UI</text>
        </Node>
        <Node x={270} y={300} w={210} h={110} title="Firestore" sub="tasks · live events" icon={Database} tone="amber">
          <text x="16" y="84" className="arch-item">tasks/{'{id}'} · events (seq)</text>
          <text x="16" y="102" className="arch-item">projects · releases</text>
        </Node>
        <Node x={540} y={300} w={145} h={110} title="Cloud Build" sub="build image" icon={Hammer} tone="orange" />
        <Node x={705} y={300} w={182} h={110} title="Artifact Registry" sub="images" icon={Box} tone="orange" />
        <Node x={905} y={286} w={175} h={138} title="Cloud Run app" sub="acme-tasks" icon={Cloud} tone="green">
          <text x="16" y="84" className="arch-item">tagged preview revision</text>
          <text x="16" y="102" className="arch-item">0% traffic → verified</text>
          <text x="16" y="120" className="arch-item">→ 100% production</text>
        </Node>

        {/* Edges */}
        <Edge d="M210 94 H266" label="request" lx={238} ly={86} />
        <Edge d="M480 94 H536" label="start job" lx={508} ly={86} />
        <Edge d="M870 99 H926" both label="Gemini" lx={898} ly={91} />
        <Edge d="M375 158 V296" label="task doc" lx={383} ly={232} anchor="start" />
        <Edge d="M600 216 V250 H440 V296" label="live events" lx={520} ly={243} />
        <Edge d="M270 355 H214" both label="realtime" lx={242} ly={347} />
        <Edge d="M115 300 V162" label="live UI" lx={123} ly={236} anchor="start" />
        <Edge d="M650 216 V296" label="submit build" lx={658} ly={262} anchor="start" />
        <Edge d="M685 355 H701" />
        <Edge d="M887 355 H901" />
        <Edge d="M820 216 V250 H992 V282" label="smoke-test preview" lx={906} ly={243} />
      </svg>
    </div>
  )
}
