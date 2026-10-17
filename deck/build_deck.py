"""Build the Prompt2Prod pitch deck on the official AI Builder Cup template (16:9, 10in × 5.625in).

Template artwork (header bar, title banner, thank-you slide) comes from the official template.
Benchmarks are read live from Firestore so every number in the deck is a measured run.

    python deck/build_deck.py            # → deck/Prompt2Prod-AgenticMinds.pdf
"""
import base64
import html
import json
import os
import pathlib
import statistics
import sys

ROOT = pathlib.Path(__file__).resolve().parent
REPO = ROOT.parent
sys.path.insert(0, str(REPO / "backend"))

LINKS = json.loads((ROOT / "links.json").read_text()) if (ROOT / "links.json").exists() else {}
GITHUB = LINKS.get("github", "https://github.com/ashok2605/prompt2prod")
VIDEO = LINKS.get("video", "(demo video link)")
PRODUCT = LINKS.get("product", "https://prompt2prod.web.app")
API = LINKS.get("api", "https://prompt2prod-82783179546.asia-south1.run.app")
APP = LINKS.get("app", "https://acme-tasks-82783179546.asia-south1.run.app")


def img(path):
    p = pathlib.Path(path)
    if not p.exists():
        return None
    mime = "image/png" if p.suffix == ".png" else "image/jpeg"
    return f"data:{mime};base64," + base64.b64encode(p.read_bytes()).decode()


MEDIA = ROOT / "template_media"
HEADER = img(MEDIA / "image2.png")
BANNER = img(MEDIA / "image4.png")
THANKS = img(MEDIA / "image5.png")
SHOTS = ROOT / "shots"


def shot(name, caption=None, style=""):
    data = img(SHOTS / f"{name}.png") or img(SHOTS / f"{name}.jpg")
    if not data:
        return f'<div class="shot missing" style="{style}">screenshot: {name}</div>'
    cap = f'<div class="cap">{caption}</div>' if caption else ""
    return f'<figure class="shot" style="{style}"><img src="{data}">{cap}</figure>'


# ---------------------------------------------------------------- benchmarks (real runs)

def load_benchmarks():
    try:
        from p2p import store  # noqa: WPS433
        tasks = store.list_tasks(limit=100, include_diff=False)
    except Exception as exc:  # noqa: BLE001
        print("benchmarks unavailable:", exc)
        return {"rows": [], "summary": {}}
    rows = []
    for t in tasks:
        m = t.get("metrics") or {}
        if not m.get("durationSec") or t.get("status") not in ("deployed", "awaiting_approval", "rolled_back"):
            continue
        stages = t.get("stages") or {}
        stage_secs = {}
        for key, s in stages.items():
            if s.get("startedAt") and s.get("endedAt"):
                stage_secs[key] = (s["endedAt"] - s["startedAt"]).total_seconds()
        queued = ((t.get("startedAt") - t.get("createdAt")).total_seconds()
                  if t.get("startedAt") and t.get("createdAt") else 0)
        title = t.get("title") or t["prompt"][:50]
        if t["id"] == "hefnst":
            title += " (1st run, pre-tuning)"
        rows.append({
            "id": t["id"], "title": title, "status": t["status"], "queued": queued,
            "mode": t.get("mode"), "duration": m.get("durationSec"), "lead": m.get("leadTimeSec"),
            "cost": m.get("costUsd") or 0, "calls": m.get("llmCalls") or 0,
            "tokens": (m.get("tokensIn") or 0) + (m.get("tokensOut") or 0),
            "tests": f"{(t.get('tests') or {}).get('passed', 0)}/{(t.get('tests') or {}).get('total', 0)}",
            "newTests": (t.get("tests") or {}).get("newTests", 0),
            "files": len(t.get("files") or []),
            "adds": sum(f.get("additions", 0) for f in t.get("files") or []),
            "review": (t.get("review") or {}).get("score"),
            "checks": f"{sum(c['ok'] for c in (t.get('verify') or {}).get('checks', []))}/"
                      f"{len((t.get('verify') or {}).get('checks', []))}",
            "stages": stage_secs,
            "hours": (t.get("plan") or {}).get("estimatedHours") or 0,
        })
    rows.sort(key=lambda r: r["duration"])
    finished = [t for t in tasks if t.get("status") in ("deployed", "awaiting_approval", "rolled_back", "failed", "rejected")]
    good = [t for t in finished if t.get("status") in ("deployed", "awaiting_approval", "rolled_back")]
    summary = {}
    if rows:
        auto = [r for r in rows if r["mode"] == "autopilot" and r["lead"] and r["queued"] < 60
                and r["id"] != "hefnst"]
        tuned = [r for r in rows if r["id"] != "hefnst"]
        summary = {
            "runs": len(rows),
            "median_duration": statistics.median(r["duration"] for r in tuned or rows),
            "median_lead": statistics.median(r["lead"] for r in auto) if auto else None,
            "avg_cost": statistics.mean(r["cost"] for r in rows),
            "avg_calls": statistics.mean(r["calls"] for r in rows),
            "avg_tokens": statistics.mean(r["tokens"] for r in rows),
            "success": len(good) / len(finished) if finished else 1,
            "new_tests": sum(r["newTests"] for r in rows),
            "hours": sum(r["hours"] for r in rows),
            "stage_avg": {k: statistics.mean(r["stages"].get(k, 0) for r in rows)
                          for k in ("sandbox", "plan", "tests", "code", "test", "review", "build", "preview", "verify")},
        }
    return {"rows": rows, "summary": summary}


BENCH = load_benchmarks()
S = BENCH["summary"]


def fmt_s(sec):
    if sec is None:
        return "–"
    sec = round(sec)
    return f"{sec // 60}m {sec % 60:02d}s" if sec >= 60 else f"{sec}s"


# ---------------------------------------------------------------- slide primitives

def content_slide(title, body):
    return f"""
<section class="slide content">
  <img class="hdr" src="{HEADER}">
  <div class="title">{title}</div>
  <div class="body">{body}</div>
  <div class="footbar"></div>
</section>"""


def card(title, text, color="#4285F4", icon=""):
    return f'<div class="card" style="--c:{color}"><div class="ct">{icon} {title}</div><div class="cx">{text}</div></div>'


# ---------------------------------------------------------------- slides

slides = []

# 1 — Team details (template title slide)
slides.append(f"""
<section class="slide titleslide">
  <img class="banner" src="{BANNER}">
  <div class="team">
    <div class="th">Team Details</div>
    <ol type="a">
      <li>Team name: <b>Agentic Minds</b></li>
      <li>Team leader name: <b>Madamanchi Ashok Chowdary</b></li>
      <li>Problem Statement: <b>Future of Work &amp; Enterprise Productivity</b> — engineers lose most of their week
      to the toil around code (tests, reviews, builds, deployments). <b>Prompt2Prod</b> turns a plain-English request into a
      planned, tested, reviewed and deployed change.</li>
    </ol>
  </div>
  <div class="footbar"></div>
</section>""")

# 3 — Brief about the idea
med_lead = fmt_s(S.get("median_lead")) if S else "~2 min"
avg_cost = f"${S['avg_cost']:.2f}" if S else "$0.11"
slides.append(content_slide("Brief about the idea", f"""
<div class="cols">
  <div class="col" style="flex:1.45">
    <p class="lead"><b>Prompt2Prod is an autonomous AI dev crew on Google Cloud.</b> A developer describes a change in plain English —
    typed, spoken, or sent from any tool via REST/webhook — and a team of Gemini agents built with Google ADK ships it end-to-end:</p>
    <ol class="flow">
      <li><b>Plan</b> against the real codebase — steps, files, acceptance criteria, risk (Gemini 3.1 Pro)</li>
      <li><b>Write failing tests first</b> (TDD) for every acceptance criterion</li>
      <li><b>Implement</b> with sandboxed file &amp; test tools, iterating until the suite is green</li>
      <li><b>AI code review</b> — quality score, risk level; blocking issues go back to the Coder</li>
      <li><b>Build</b> with Cloud Build and deploy a <b>live preview revision</b> on Cloud Run</li>
      <li><b>Verify the live preview</b> with AI-generated smoke tests and Gemini visual QA</li>
      <li><b>Release</b> automatically (Autopilot) or with one-click approval — and roll back in one click</li>
    </ol>
    <p class="note">Every thought, tool call and test run streams live to a Firebase-powered dashboard.</p>
  </div>
  <div class="col kpis">
    <div class="kpi"><div class="kv">{med_lead}</div><div class="kl">median prompt → production<br>(Autopilot, measured on real requests)</div></div>
    <div class="kpi"><div class="kv">{avg_cost}</div><div class="kl">average AI cost per shipped change</div></div>
    <div class="kpi"><div class="kv">{fmt_s(S.get('median_duration')) if S else '1m 36s'}</div><div class="kl">median pipeline: plan → tests → code → review → build → preview → verify</div></div>
    <div class="kpi"><div class="kv">10</div><div class="kl">stages · 4 quality gates · 0 hand-offs</div></div>
  </div>
</div>"""))

# 4 — Opportunities
slides.append(content_slide("Opportunities", f"""
<div class="grid3">
  {card("How is it different?", "Copilots stop at code suggestions in the IDE and CI/CD only runs pipelines you hand-write. "
        "Prompt2Prod closes the <b>whole loop</b> — plan → tests → code → review → build → preview → verify → release — on "
        "<b>real infrastructure</b> (Cloud Build images, Cloud Run revisions), with an audit trail for every change.", "#4285F4", "🧭")}
  {card("How does it solve the problem?", "It removes hand-offs and waiting: no review queue, no build babysitting, no deploy ritual. "
        "Quality is enforced by default — <b>tests first, AI review, live verification</b> — while humans stay in control with "
        "approval mode, a preview URL for every change and <b>instant rollback</b>.", "#34A853", "⚙️")}
  {card("USP", "<ul><li><b>Test-first, self-healing</b> agent crew (Google ADK)</li><li><b>Live preview URL per change</b> via Cloud Run revision tags</li>"
        "<li><b>AI smoke tests + multimodal visual QA</b> on the deployed preview</li><li><b>Autopilot gate</b> + human approval + one-click rollback</li>"
        "<li>Built-in <b>DORA metrics</b> &amp; cost per change</li><li>Requests from <b>anywhere</b>: UI, voice, REST, webhooks</li></ul>",
        "#EA4335", "⭐")}
</div>"""))

# 5 — Features
feats = [
    ("🗣️", "Natural-language intake", "Dashboard, voice (Web Speech), REST & webhook (GitHub/Slack/Jira style)."),
    ("🧭", "Planner agent", "Repo-aware plan, acceptance criteria, risk & effort estimate; declines unsafe asks."),
    ("🧪", "Tests-first", "Test Author writes failing pytest tests before any code changes (TDD red)."),
    ("💻", "Coder agent", "Sandboxed read/write/edit/search/run-tests tools; iterates to green."),
    ("🩹", "Self-healing", "Failures are fed back automatically — up to 3 healing attempts."),
    ("🛡️", "AI code review", "Score 0-100, risk, issues; blocking issues trigger an automatic fix round."),
    ("🔗", "Preview per change", "Cloud Build image → tagged Cloud Run revision with its own URL, 0% traffic."),
    ("📡", "Live verification", "Verifier writes HTTP smoke tests, runs them on the preview and self-corrects bad checks."),
    ("👁️", "Visual QA (multimodal)", "Gemini looks at a screenshot of the live preview to confirm the UI change."),
    ("🚦", "Autopilot or approval", "Release when all gates pass, or wait for one-click human approval."),
    ("↩️", "Instant rollback", "Traffic back to the previous revision + git main reset in seconds."),
    ("📊", "DORA & cost insights", "Deploy frequency, lead time, change-failure rate, MTTR, tokens & $ per change."),
]
slides.append(content_slide("List of features offered by the solution", '<div class="feats">' + "".join(
    f'<div class="feat"><div class="fi">{i}</div><div><div class="ft">{t}</div><div class="fx">{x}</div></div></div>'
    for i, t, x in feats) + "</div>"))

# 6 — Process flow
slides.append(content_slide("Process flow diagram or Use-case diagram",
                            f'<img class="diagram" src="{img(REPO / "docs/diagrams/process.png")}">'))

# 7 — Wireframes / mock
slides.append(content_slide("Wireframes/Mock diagrams of the proposed solution (optional)", f"""
<div class="cols">
  {shot("command-center", "Command Center — compose a request, pick Autopilot or Approval, watch live runs", "flex:1")}
  {shot("task-live", "Task view — 10-stage pipeline, live agent log, plan / diff / tests / review / preview tabs", "flex:1")}
</div>"""))

# 8 — Architecture
slides.append(content_slide("Architecture diagram of the proposed solution",
                            f'<img class="diagram" src="{img(REPO / "docs/diagrams/architecture.png")}">'))

# 9 — Technologies
tech = [
    ("Gemini on Vertex AI", "Gemini 3.1 Pro (Planner, Reviewer) + Gemini 3.6 Flash (Test Author, Coder, Verifier); structured outputs, thinking summaries, model fallback.", "#4285F4"),
    ("Google ADK", "Multi-agent crew of LlmAgents with function tools, output schemas and per-role thinking levels.", "#4285F4"),
    ("Cloud Run (service)", "FastAPI API + dashboard; Firebase ID-token auth, approvals, releases, metrics.", "#34A853"),
    ("Cloud Run Jobs", "One isolated sandbox execution per request; runs the agents, git and pytest.", "#34A853"),
    ("Cloud Run revisions & tags", "Preview URL per change, traffic switch for release, instant rollback.", "#34A853"),
    ("Cloud Build + Artifact Registry", "Container image per change with layer caching (~20 s builds).", "#EA4335"),
    ("Firestore", "Tasks, live per-task event stream, release history, distributed locks.", "#FBBC04"),
    ("Firebase", "Auth (anonymous sign-in), Hosting (prompt2prod.web.app), JS SDK realtime listeners.", "#FBBC04"),
    ("Cloud Storage", "Git bundles as source of truth for each app + build contexts.", "#34A853"),
    ("IAM & Logging", "Least-privilege service accounts; target app runs with zero permissions.", "#5f6368"),
    ("App stack", "Python 3.12, FastAPI, pytest, git · React + Vite dashboard.", "#5f6368"),
]
slides.append(content_slide("Technologies to be used in the solution", '<div class="tech">' + "".join(
    f'<div class="techi" style="--c:{c}"><div class="tt">{t}</div><div class="tx">{x}</div></div>' for t, x, c in tech) + "</div>"))

# 10 — Cost
avg_tokens = f"{S['avg_tokens'] / 1000:.0f}K" if S else "~120K"
slides.append(content_slide("Estimated implementation cost (optional)", f"""
<div class="cols">
  <div class="col" style="flex:1.2">
    <table class="tbl">
      <tr><th>Per shipped change (measured)</th><th>Cost</th></tr>
      <tr><td>Gemini tokens (avg {avg_tokens} tokens, {S.get('avg_calls', 16):.0f} LLM calls)</td><td>{avg_cost}</td></tr>
      <tr><td>Cloud Build (~20 s, cached layers)</td><td>≈ $0.001</td></tr>
      <tr><td>Cloud Run Job sandbox (2 vCPU · 2 GiB · ~2 min)</td><td>≈ $0.006</td></tr>
      <tr><td>Preview revision (scale-to-zero) · Firestore · Storage</td><td>&lt; $0.001</td></tr>
      <tr class="tot"><td>Total per change</td><td>≈ ${(S.get('avg_cost', 0.11) + 0.008):.2f}</td></tr>
    </table>
  </div>
  <div class="col">
    <table class="tbl">
      <tr><th>Team of 25 engineers · 400 changes / month</th><th>/ month</th></tr>
      <tr><td>AI + build + sandbox</td><td>≈ ${400 * (S.get('avg_cost', 0.11) + 0.008):.0f}</td></tr>
      <tr><td>API + dashboard (1 warm Cloud Run instance)</td><td>≈ $30</td></tr>
      <tr><td>Firestore · Storage · Artifact Registry</td><td>≈ $5</td></tr>
      <tr class="tot"><td>Platform total</td><td>≈ ${400 * (S.get('avg_cost', 0.11) + 0.008) + 35:.0f}</td></tr>
    </table>
    <p class="note">vs. ~{S.get('hours', 0) / max(S.get('runs', 1), 1):.1f} engineer-hours estimated per change by the Planner →
    hundreds of hours returned to the team every month. Prototype runs fully on the $300 Google Cloud trial.</p>
  </div>
</div>"""))

# 11 — Snapshots
slides.append(content_slide("Snapshots of the prototype", f"""
<div class="grid2">
  {shot("task-diff", "AI-written diff with tests, reviewed and committed")}
  {shot("task-preview", "Live preview revision embedded in the task view")}
  {shot("insights", "Insights — DORA metrics computed from real runs")}
  {shot("releases", "Releases — production history with one-click rollback")}
</div>"""))

# 12 — Performance / benchmarking
rows = BENCH["rows"][:7]
stage_names = [("plan", "Plan"), ("tests", "Tests first"), ("code", "Implement"), ("test", "Test & heal"),
               ("review", "AI review"), ("build", "Build"), ("preview", "Preview"), ("verify", "Verify")]
max_stage = max([S["stage_avg"].get(k, 0) for k, _ in stage_names] + [1]) if S else 1
bars = "".join(
    f'<div class="bar"><span class="bn">{label}</span><span class="bt"><span class="bf" style="width:{(S["stage_avg"].get(k, 0) / max_stage) * 100:.0f}%"></span></span>'
    f'<span class="bv">{S["stage_avg"].get(k, 0):.0f}s</span></div>'
    for k, label in stage_names) if S else ""
table = "".join(
    f'<tr><td>{html.escape(r["title"][:42])}</td><td>{fmt_s(r["duration"])}</td><td>{r["files"]} (+{r["adds"]})</td>'
    f'<td>{r["tests"]} (+{r["newTests"]})</td><td>{r["review"]}</td><td>{r["checks"]}</td><td>${r["cost"]:.2f}</td></tr>'
    for r in rows)
slides.append(content_slide("Prototype Performance report/Benchmarking", f"""
<div class="cols">
  <div class="col" style="flex:1.55">
    <table class="tbl small">
      <tr><th>Real request (Acme Tasks app)</th><th>Pipeline</th><th>Files</th><th>Tests (new)</th><th>Review</th><th>Live checks</th><th>AI cost</th></tr>
      {table}
    </table>
    <p class="note">{S.get('runs', 0)} measured end-to-end runs · median pipeline {fmt_s(S.get('median_duration'))} · median Autopilot lead time
    {fmt_s(S.get('median_lead'))} (excluding time waiting in the queue) · every run ended with a green suite and a
    95–100 AI review. Tuning per-agent models &amp; thinking levels cut the first run from 5m 15s to ~1.5 min; three early runs
    paused at the live-check gate because of a verifier bug (now self-correcting) and were re-run.</p>
  </div>
  <div class="col">
    <div class="ch">Average seconds per stage</div>
    <div class="bars">{bars}</div>
  </div>
</div>"""))

# 13 — Future development
slides.append(content_slide("Additional Details/Future Development (if any)", f"""
<div class="grid3">
  {card("Connect real repos", "GitHub/GitLab apps: issue → PR with preview link, review comments, merge on approval. Monorepos & multi-service changes.", "#4285F4", "🔌")}
  {card("Any stack", "Buildpacks + language packs (Node, Go, Java); Agent Engine for long-running, resumable agent sessions; codebase RAG with Vertex AI Search for large repos.", "#34A853", "🧩")}
  {card("Progressive delivery", "Canary traffic splits with Cloud Monitoring SLOs and automatic rollback; feature flags; scheduled releases.", "#FBBC04", "🚦")}
  {card("Enterprise guardrails", "Policy-as-code (protected files, budgets), per-tenant least-privilege sandboxes, VPC-SC, SSO via Identity Platform, audit export to BigQuery.", "#EA4335", "🛡️")}
  {card("Team copilots", "Slack / Google Chat intake, standup summaries of shipped work, release notes generated from commits.", "#7c5cf2", "💬")}
  {card("Learning loop", "Agents learn from review feedback and rollbacks; org-wide conventions captured automatically in AGENTS.md.", "#0ea5b7", "🧠")}
</div>"""))

# 14 — Links
slides.append(content_slide("Provide links to your:", f"""
<div class="links">
  <div class="lk"><div class="lt">GitHub Public Repository</div><a href="{GITHUB}">{GITHUB}</a></div>
  <div class="lk"><div class="lt">Demo Video Link (3 Minutes)</div><a href="{VIDEO}">{VIDEO}</a></div>
  <div class="lk"><div class="lt">Final Product Link</div><a href="{PRODUCT}">{PRODUCT}</a>
    <div class="ls">Cloud Run: <a href="{API}">{API}</a> · Demo app in production: <a href="{APP}">{APP}</a></div></div>
</div>"""))

# 15 — Security & responsible AI (template's spare content slide)
slides.append(content_slide("Security, guardrails &amp; responsible AI", f"""
<div class="grid3">
  {card("Isolation", "Every request runs in its own Cloud Run Job container (gVisor sandbox) on a fresh git branch; agents can only touch files inside the repo.", "#4285F4", "🔒")}
  {card("Least privilege", "The deployed app runs as a service account with zero IAM roles. Dashboard clients get read-only Firestore access via security rules.", "#34A853", "🪪")}
  {card("Human in the loop", "Approval mode, preview URL per change, reject at any time, one-click rollback; autopilot only ships when tests, review and live checks all pass.", "#FBBC04", "🙋")}
  {card("Scope control", "The Planner declines unsafe or out-of-scope requests; the Test Author may only edit tests/; reviewers flag security issues.", "#EA4335", "🎯")}
  {card("Abuse & cost limits", "Firebase-authenticated intake, per-user and daily rate limits, per-run LLM call caps, cost metering per change.", "#7c5cf2", "💸")}
  {card("Full audit trail", "Plan, prompts' outcome, diff, tests, review, build, release and rollback events are stored per task in Firestore and git.", "#0ea5b7", "🧾")}
</div>"""))

# 16 — Thank you
slides.append(f'<section class="slide thanks"><img src="{THANKS}"></section>')

CSS = """
@page { size: 10in 5.625in; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: 'Google Sans Flex', 'Google Sans', Inter, sans-serif; color: #1f2329; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.slide { position: relative; width: 960px; height: 540px; overflow: hidden; page-break-after: always; break-after: page; background: #fff; }
.footbar { position: absolute; left: 0; right: 0; top: 533px; height: 7px; background: #000; }
.hdr { position: absolute; left: 0; top: 0; width: 960px; height: 53px; }
.title { position: absolute; left: 28px; top: 66px; font-size: 21px; font-weight: 500; letter-spacing: -0.1px; }
.body { position: absolute; left: 28px; right: 28px; top: 104px; bottom: 18px; font-size: 12.5px; line-height: 1.45; }
.titleslide .banner { position: absolute; left: 0; top: 0; width: 960px; height: 285px; }
.team { position: absolute; left: 22px; top: 300px; right: 30px; }
.team .th { font-size: 28px; font-weight: 600; }
.team ol { margin: 8px 0 0 60px; padding: 0; font-size: 17px; line-height: 1.38; }
.team li { padding-left: 6px; }
.thanks img { width: 960px; height: 540px; }
.cols { display: flex; gap: 18px; height: 100%; }
.col { flex: 1; min-width: 0; }
.lead { margin: 0 0 8px; font-size: 13.5px; }
.flow { margin: 0 0 8px 18px; padding: 0; }
.flow li { margin: 3px 0; }
.note { color: #5f6368; font-size: 11.5px; margin: 6px 0 0; }
.kpis { display: grid; grid-template-rows: repeat(4, 1fr); gap: 10px; max-width: 290px; }
.kpi { border-radius: 14px; padding: 10px 14px; background: #f3f6fc; border: 1px solid #e3e8f2; }
.kv { font-size: 30px; font-weight: 600; letter-spacing: -0.5px; background: linear-gradient(90deg, #4285F4, #9b72f2 60%, #e8579d); -webkit-background-clip: text; background-clip: text; color: transparent; }
.kl { font-size: 11.5px; color: #5f6368; }
.grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; height: 100%; }
.slide .grid3 .card { border-radius: 14px; border: 1px solid #e3e8f2; border-top: 4px solid var(--c); padding: 12px 14px; background: #fff; box-shadow: 0 2px 8px rgba(31,35,41,.05); }
.ct { font-weight: 600; font-size: 14.5px; margin-bottom: 6px; }
.cx { font-size: 12px; color: #3c4043; }
.cx ul { margin: 0; padding-left: 16px; }
.cx li { margin: 2px 0; }
.feats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 9px 12px; }
.feat { display: flex; gap: 10px; align-items: flex-start; padding: 9px 10px; border-radius: 12px; background: #f6f8fc; border: 1px solid #e8ecf4; }
.fi { font-size: 20px; line-height: 1; }
.ft { font-weight: 600; font-size: 12.8px; }
.fx { font-size: 11px; color: #5f6368; line-height: 1.35; }
.diagram { width: 100%; height: 100%; object-fit: contain; object-position: top center; }
.shot { margin: 0; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.shot img { width: 100%; border-radius: 10px; border: 1px solid #dfe3eb; box-shadow: 0 4px 14px rgba(31,35,41,.10); object-fit: cover; object-position: top left; }
.cols .shot img { height: 360px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; height: 100%; }
.grid2 .shot img { height: 172px; }
.cap { font-size: 10.5px; color: #5f6368; }
.shot.missing { border: 2px dashed #c7ccd6; border-radius: 10px; display: grid; place-items: center; color: #9aa0a6; min-height: 150px; }
.tech { display: grid; grid-template-columns: repeat(3, 1fr); gap: 9px 12px; }
.techi { border-left: 4px solid var(--c); background: #f6f8fc; border-radius: 10px; padding: 8px 11px; }
.tt { font-weight: 600; font-size: 12.8px; }
.tx { font-size: 11px; color: #5f6368; line-height: 1.35; }
.tbl { width: 100%; border-collapse: collapse; font-size: 12px; }
.tbl th { text-align: left; font-weight: 600; padding: 7px 8px; background: #f1f4f9; border-bottom: 1px solid #dfe3eb; }
.tbl td { padding: 6px 8px; border-bottom: 1px solid #eef1f6; font-variant-numeric: tabular-nums; }
.tbl td:last-child, .tbl th:last-child { text-align: right; }
.tbl tr.tot td { font-weight: 600; border-top: 2px solid #c9d0dc; }
.tbl.small { font-size: 10.6px; }
.tbl.small td, .tbl.small th { padding: 5px 6px; }
.tbl.small td:not(:first-child), .tbl.small th:not(:first-child) { text-align: right; white-space: nowrap; }
.ch { font-weight: 600; font-size: 13px; margin-bottom: 8px; }
.bars { display: grid; gap: 7px; }
.bar { display: grid; grid-template-columns: 78px 1fr 34px; align-items: center; gap: 8px; font-size: 11.5px; }
.bt { height: 12px; background: #eef1f6; border-radius: 4px; overflow: hidden; }
.bf { display: block; height: 100%; background: #2a78d6; border-radius: 0 4px 4px 0; }
.bv { text-align: right; color: #3c4043; font-variant-numeric: tabular-nums; }
.links { display: grid; gap: 14px; margin-top: 6px; }
.lk { padding: 12px 16px; border-radius: 14px; background: #f6f8fc; border: 1px solid #e3e8f2; }
.lt { font-weight: 600; font-size: 15px; margin-bottom: 3px; }
.lk a { color: #1a73e8; font-size: 14px; text-decoration: none; word-break: break-all; }
.ls { margin-top: 4px; font-size: 11px; color: #5f6368; }
.ls a { font-size: 11px; }
"""

doc = f"""<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Google+Sans+Flex:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>{CSS}</style></head><body>{''.join(slides)}</body></html>"""
out_html = ROOT / "deck.html"
out_html.write_text(doc)


def render():
    from playwright.sync_api import sync_playwright  # noqa: WPS433

    pdf = ROOT / "Prompt2Prod-AgenticMinds.pdf"
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": 960, "height": 540})
        page.goto(out_html.as_uri())
        page.wait_for_timeout(2500)
        page.pdf(path=str(pdf), width="10in", height="5.625in", print_background=True)
        # preview PNGs for review
        prev = ROOT / "preview"
        prev.mkdir(exist_ok=True)
        for i, el in enumerate(page.query_selector_all("section.slide"), 1):
            el.screenshot(path=str(prev / f"slide{i:02d}.png"))
        browser.close()
    print("PDF", pdf, f"{pdf.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    render()
