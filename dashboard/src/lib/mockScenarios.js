// Offline demo content: the baseline "Acme Tasks" repository (a Flask team
// task tracker) and a set of realistic change scenarios. Each scenario is a
// list of edits against the baseline; the unified diff, file stats, pytest
// output and failure tracebacks are all derived from those edits so they stay
// internally consistent.
import { parseDiff } from './diff.js'
import { fileDiff } from './mockDiff.js'

const code = (strings, ...vals) => String.raw(strings, ...vals).replace(/^\n/, '')

const A = 'app.py'
const T = 'templates/index.html'
const S = 'static/style.css'
const X = 'tests/test_api.py'

// ---------------------------------------------------------------------------
// Baseline repository — acme-tasks @ a1b2c3d
// ---------------------------------------------------------------------------
const APP_PY = code`
"""Acme Tasks — a tiny team task tracker (Flask + JSON API)."""
from __future__ import annotations

import itertools
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone

from flask import Flask, abort, jsonify, render_template, request

app = Flask(__name__)
_ids = itertools.count(1)


@dataclass
class Task:
    id: int
    title: str
    assignee: str | None = None
    done: bool = False
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


TASKS: dict[int, Task] = {}


def seed() -> None:
    for title, who in [
        ("Draft Q3 roadmap", "maya"),
        ("Fix login redirect loop", "dev"),
        ("Plan team offsite", "sam"),
    ]:
        task = Task(id=next(_ids), title=title, assignee=who)
        TASKS[task.id] = task


@app.get("/")
def index():
    tasks = sorted(TASKS.values(), key=lambda t: t.id)
    return render_template("index.html", tasks=tasks)


@app.get("/api/tasks")
def list_tasks():
    return jsonify([asdict(t) for t in TASKS.values()])


@app.post("/api/tasks")
def create_task():
    data = request.get_json(silent=True) or {}
    task = Task(id=next(_ids), title=data.get("title", ""), assignee=data.get("assignee"))
    TASKS[task.id] = task
    return jsonify(asdict(task)), 201


@app.patch("/api/tasks/<int:task_id>")
def update_task(task_id: int):
    task = TASKS.get(task_id) or abort(404)
    data = request.get_json(silent=True) or {}
    if "done" in data:
        task.done = bool(data["done"])
    if "title" in data:
        task.title = data["title"]
    return jsonify(asdict(task))


@app.get("/healthz")
def healthz():
    return {"ok": True}


seed()
`

const INDEX_HTML = code`
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Acme Tasks</title>
  <link rel="stylesheet" href="{{ url_for('static', filename='style.css') }}">
</head>
<body>
  <header class="topbar">
    <h1>Acme Tasks</h1>
    <span class="muted">{{ tasks|length }} tasks</span>
  </header>

  <main class="container">
    <form id="new-task" class="new-task">
      <input name="title" placeholder="What needs doing?" autocomplete="off" required>
      <input name="assignee" placeholder="Assignee">
      <button type="submit">Add task</button>
    </form>

    <ul class="task-list">
      {% for task in tasks %}
      <li class="task {{ 'done' if task.done }}" data-id="{{ task.id }}">
        <input type="checkbox" {{ 'checked' if task.done }} aria-label="Mark {{ task.title }} done">
        <span class="title">{{ task.title }}</span>
        <span class="assignee">@{{ task.assignee or 'unassigned' }}</span>
      </li>
      {% endfor %}
    </ul>
  </main>

  <script>
    document.getElementById("new-task").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.target));
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) location.reload();
    });

    document.querySelectorAll(".task input[type=checkbox]").forEach((box) => {
      box.addEventListener("change", async () => {
        const id = box.closest(".task").dataset.id;
        await fetch("/api/tasks/" + id, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ done: box.checked }),
        });
        location.reload();
      });
    });
  </script>
</body>
</html>
`

const STYLE_CSS = code`
* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  background: #f7f7f8;
  color: #1f2328;
}

.topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 24px;
  background: #ffffff;
  border-bottom: 1px solid #e5e7eb;
}

.topbar h1 { font-size: 20px; margin: 0; }
.muted { color: #6b7280; }
.container { max-width: 720px; margin: 24px auto; padding: 0 16px; }

.new-task { display: flex; gap: 8px; margin-bottom: 16px; }
.new-task input { flex: 1; padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 6px; }
.new-task button { padding: 8px 14px; border: 0; border-radius: 6px; background: #2563eb; color: #fff; }

.task-list { list-style: none; padding: 0; margin: 0; }
.task {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  margin-bottom: 8px;
}
.task.done .title { text-decoration: line-through; color: #9ca3af; }
.assignee { margin-left: auto; color: #6b7280; font-size: 14px; }
`

const TEST_PY = code`
import itertools

import pytest

import app as acme


@pytest.fixture()
def client():
    acme.TASKS.clear()
    acme._ids = itertools.count(1)
    acme.seed()
    acme.app.config.update(TESTING=True)
    with acme.app.test_client() as c:
        yield c


def test_healthz(client):
    assert client.get("/healthz").get_json() == {"ok": True}


def test_index_lists_seeded_tasks(client):
    html = client.get("/").get_data(as_text=True)
    assert "Draft Q3 roadmap" in html


def test_list_tasks_returns_json(client):
    data = client.get("/api/tasks").get_json()
    assert isinstance(data, list) and len(data) == 3


def test_create_task(client):
    res = client.post("/api/tasks", json={"title": "Write release notes"})
    assert res.status_code == 201
    assert res.get_json()["title"] == "Write release notes"


def test_create_task_with_assignee(client):
    res = client.post("/api/tasks", json={"title": "Ship it", "assignee": "maya"})
    assert res.get_json()["assignee"] == "maya"


def test_new_task_is_not_done(client):
    res = client.post("/api/tasks", json={"title": "Triage inbox"})
    assert res.get_json()["done"] is False


def test_mark_task_done(client):
    res = client.patch("/api/tasks/1", json={"done": True})
    assert res.get_json()["done"] is True


def test_rename_task(client):
    res = client.patch("/api/tasks/2", json={"title": "Fix login loop"})
    assert res.get_json()["title"] == "Fix login loop"


def test_update_missing_task_returns_404(client):
    assert client.patch("/api/tasks/999", json={"done": True}).status_code == 404


def test_task_ids_increment(client):
    first = client.post("/api/tasks", json={"title": "A"}).get_json()["id"]
    second = client.post("/api/tasks", json={"title": "B"}).get_json()["id"]
    assert second == first + 1


def test_created_at_is_iso8601(client):
    created = client.get("/api/tasks").get_json()[0]["created_at"]
    assert "T" in created
`

export const BASE_FILES = { [A]: APP_PY, [T]: INDEX_HTML, [S]: STYLE_CSS, [X]: TEST_PY }
export const BASE_TEST_NAMES = [...TEST_PY.matchAll(/^def (test_\w+)\(/gm)].map((m) => m[1])

export const REPO_TREE = code`
acme-tasks/
├── Dockerfile
├── app.py
├── requirements.txt
├── static/
│   └── style.css
├── templates/
│   └── index.html
└── tests/
    └── test_api.py
`

export const lineCount = (path) => (BASE_FILES[path] || '').replace(/\n$/, '').split('\n').length

// Common anchors -------------------------------------------------------------
const LINK = `  <link rel="stylesheet" href="{{ url_for('static', filename='style.css') }}">\n`
const style = (css) => [T, LINK, `${LINK}  <style>\n${css}  </style>\n`]
const INDEX_DEF = '@app.get("/")\ndef index():\n'
const INDEX_FULL = '@app.get("/")\ndef index():\n    tasks = sorted(TASKS.values(), key=lambda t: t.id)\n    return render_template("index.html", tasks=tasks)\n'
const CREATE_LINE = '    task = Task(id=next(_ids), title=data.get("title", ""), assignee=data.get("assignee"))\n'
const COUNT_SPAN = '    <span class="muted">{{ tasks|length }} tasks</span>\n'
const SCRIPT_OPEN = '  <script>\n'
const tests = (body) => [X, null, `\n\n${body}`]

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------
export const SCENARIOS = [
  {
    key: 'priority',
    match: /priorit/i,
    prompt: 'Add a priority field (low/medium/high) to tasks with colored badges in the UI and API validation',
    title: 'Add task priority badges',
    summary:
      'Add a `priority` field (low / medium / high, default medium) to the Task model, validate it in one helper shared by POST and PATCH, and render a colored, labelled badge for every task in the list.',
    steps: [
      'Add PRIORITIES and a priority field (default "medium") to the Task dataclass',
      'Validate priority in a parse_priority() helper used by POST and PATCH; unknown values return 400',
      'Return JSON error bodies for 400s so API clients can show the message',
      'Render a colored badge with the priority label next to each task, plus a priority picker in the form',
      'Cover defaults, validation and rendering with pytest',
    ],
    acceptance: [
      'POST /api/tasks accepts priority low | medium | high and defaults to medium',
      'An invalid priority returns 400 with a helpful JSON error',
      'Every task in the list shows a colored badge that includes the label text',
      'All existing tests keep passing',
    ],
    risk: 'low',
    estimatedHours: 3.5,
    commit: 'feat(tasks): add priority field with colored badges',
    planThought:
      'Priority belongs on the Task dataclass with a safe default so existing tasks and API clients keep working. Validation should live in one helper used by both POST and PATCH.',
    codeThought: 'Adding PRIORITIES + DEFAULT_PRIORITY, a priority field on Task and a parse_priority() helper, then the badge and a picker in the template.',
    codeNote: 'Badge palette: low → slate, medium → amber, high → red — every badge also shows its label text',
    edits: [
      [A, '_ids = itertools.count(1)\n', '_ids = itertools.count(1)\n\nPRIORITIES = ("low", "medium", "high")\nDEFAULT_PRIORITY = "medium"\n'],
      [A, '    done: bool = False\n', '    done: bool = False\n    priority: str = DEFAULT_PRIORITY\n'],
      [A, code`
    for title, who in [
        ("Draft Q3 roadmap", "maya"),
        ("Fix login redirect loop", "dev"),
        ("Plan team offsite", "sam"),
    ]:
        task = Task(id=next(_ids), title=title, assignee=who)
`, code`
    for title, who, priority in [
        ("Draft Q3 roadmap", "maya", "high"),
        ("Fix login redirect loop", "dev", "medium"),
        ("Plan team offsite", "sam", "low"),
    ]:
        task = Task(id=next(_ids), title=title, assignee=who, priority=priority)
`],
      [A, INDEX_DEF, code`
def parse_priority(value) -> str:
    """Normalize a priority or abort with a helpful 400."""
    priority = str(value).strip().lower()
    if priority not in PRIORITIES:
        abort(400, description=f"priority must be one of: {', '.join(PRIORITIES)}")
    return priority


@app.errorhandler(400)
def bad_request(err):
    return jsonify(error=err.description), 400


${INDEX_DEF}`],
      [A, CREATE_LINE, code`
    priority = parse_priority(data.get("priority", DEFAULT_PRIORITY))
    task = Task(
        id=next(_ids),
        title=data.get("title", ""),
        assignee=data.get("assignee"),
        priority=priority,
    )
`],
      [A, '        task.title = data["title"]\n', '        task.title = data["title"]\n    if "priority" in data:\n        task.priority = parse_priority(data["priority"])\n'],
      style(code`
    .badge { font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 999px; }
    .badge-low { background: #eef2f7; color: #475569; }
    .badge-medium { background: #fff4d6; color: #8a5a00; }
    .badge-high { background: #fde2e1; color: #b42318; }
`),
      [T, '      <input name="assignee" placeholder="Assignee">\n', code`
      <input name="assignee" placeholder="Assignee">
      <select name="priority" aria-label="Priority">
        <option value="low">Low</option>
        <option value="medium" selected>Medium</option>
        <option value="high">High</option>
      </select>
`],
      [T, '        <span class="title">{{ task.title }}</span>\n', code`
        <span class="title">{{ task.title }}</span>
        <span class="badge badge-{{ task.priority }}">{{ task.priority|capitalize }}</span>
`],
      tests(code`
def test_create_task_defaults_to_medium_priority(client):
    res = client.post("/api/tasks", json={"title": "Book venue"})
    assert res.get_json()["priority"] == "medium"


def test_create_task_rejects_invalid_priority(client):
    res = client.post("/api/tasks", json={"title": "Book venue", "priority": "urgent"})
    assert res.status_code == 400
    assert "priority must be one of" in res.get_json()["error"]


def test_index_renders_priority_badge(client):
    html = client.get("/").get_data(as_text=True)
    assert 'class="badge badge-high"' in html
`),
    ],
    red: {
      test_create_task_defaults_to_medium_priority: "KeyError: 'priority'",
      test_create_task_rejects_invalid_priority: 'assert 201 == 400',
      test_index_renders_priority_badge: 'AssertionError',
    },
    heal: [
      {
        failing: [
          {
            name: 'test_create_task_rejects_invalid_priority',
            at: '["error"]',
            e: ["E       TypeError: 'NoneType' object is not subscriptable"],
            error: "TypeError: 'NoneType' object is not subscriptable",
            kind: 'TypeError',
          },
          {
            name: 'test_index_renders_priority_badge',
            at: 'badge badge-high',
            e: [
              `E       assert 'class="badge badge-high"' in '<!doctype html>\\n<html lang="en">\\n<head>\\n  <meta charset="utf-8">...'`,
            ],
            error: 'AssertionError: assert \'class="badge badge-high"\' in \'<!doctype html>…\'',
            kind: 'AssertionError',
          },
        ],
        fixes: [
          {
            thought: 'abort(400) renders Flask’s HTML error page, so get_json() returns None. Registering a JSON error handler for 400 responses.',
            file: A,
            change: '+4',
            patch: '+@app.errorhandler(400)\n+def bad_request(err):\n+    return jsonify(error=err.description), 400\n+',
          },
          {
            thought: 'The badge was rendered as class="priority-high", but the test contract expects "badge badge-high". Aligning the template with the tests.',
            file: T,
            change: '+1 −1',
            patch: '-        <span class="priority-{{ task.priority }}">{{ task.priority }}</span>\n+        <span class="badge badge-{{ task.priority }}">{{ task.priority|capitalize }}</span>',
          },
        ],
      },
    ],
    review: {
      score: 92,
      risk: 'low',
      verdict: 'approve',
      summary:
        'Clean, well-scoped change. Validation is centralized in parse_priority() and reused by POST and PATCH, the default keeps existing API clients working, and the new tests cover the contract. Two small suggestions, no blockers.',
      issues: [
        { severity: 'minor', file: A, message: 'parse_priority() coerces non-strings with str(); consider rejecting non-string input such as {"priority": 3} explicitly.' },
        { severity: 'info', file: T, message: 'Badges show the label text as well as color, so priority is not conveyed by color alone. Nice.' },
      ],
    },
    reviewNote: 'No new dependencies · no secrets · input validated at the API boundary',
    verify: [
      { name: 'Home page renders priority badges', method: 'GET', path: '/', status: 200, ms: 142, detail: "found 'badge badge-high' in the task list" },
      { name: 'Create a high-priority task', method: 'POST', path: '/api/tasks', status: 201, ms: 96, detail: 'priority "high" echoed back' },
      { name: 'Invalid priority is rejected', method: 'POST', path: '/api/tasks', status: 400, ms: 88, detail: 'error: priority must be one of: low, medium, high' },
      { name: 'Health check', method: 'GET', path: '/healthz', status: 200, ms: 41, detail: '{"ok": true}' },
    ],
    preview: { priority: true },
  },

  {
    key: 'stats',
    match: /\/api\/stats|progress bar|completion|\bstats\b/i,
    prompt: 'Add GET /api/stats with total, done and completion % and show a progress bar on the page',
    title: 'Add completion stats API and progress bar',
    summary:
      'Expose aggregate task stats at GET /api/stats (total, done, completion %) from a single compute_stats() helper, and render an accessible progress bar in the page header that uses the same numbers.',
    steps: [
      'Add compute_stats() returning total, done and completion_pct (1 decimal, 0 when there are no tasks)',
      'Add GET /api/stats returning compute_stats() as JSON',
      'Pass the stats to the index template and render a role="progressbar" in the header',
      'Test empty, partial and rendered states',
    ],
    acceptance: [
      'GET /api/stats returns total, done and completion_pct',
      'completion_pct is 0 when there are no tasks (no division by zero)',
      'The header shows a progress bar that reflects completion %',
      'All existing tests keep passing',
    ],
    risk: 'low',
    estimatedHours: 2.5,
    commit: 'feat(stats): add /api/stats and header progress bar',
    planThought: 'One helper should own the math so the API and the page can never disagree. Empty task lists are the edge case to guard.',
    codeThought: 'Writing compute_stats(), the /api/stats route, and a progress bar in the header that reads the same dict.',
    codeNote: 'Progress bar uses role="progressbar" with aria-valuenow so screen readers announce completion',
    edits: [
      [A, INDEX_FULL, code`
def compute_stats() -> dict:
    total = len(TASKS)
    done = sum(1 for t in TASKS.values() if t.done)
    pct = round(done / total * 100, 1) if total else 0.0
    return {"total": total, "done": done, "completion_pct": pct}


@app.get("/")
def index():
    tasks = sorted(TASKS.values(), key=lambda t: t.id)
    return render_template("index.html", tasks=tasks, stats=compute_stats())
`],
      [A, '@app.post("/api/tasks")\n', code`
@app.get("/api/stats")
def stats():
    return jsonify(compute_stats())


@app.post("/api/tasks")
`],
      style(code`
    .stats { display: flex; align-items: center; gap: 10px; margin-left: auto; }
    .progress { width: 160px; height: 8px; border-radius: 999px; background: #e5e7eb; overflow: hidden; }
    .progress-fill { height: 100%; background: #16a34a; transition: width 0.3s ease; }
`),
      [T, COUNT_SPAN, code`
    <span class="muted">{{ tasks|length }} tasks</span>
    <div class="stats">
      <div class="progress" role="progressbar" aria-label="Completion"
           aria-valuenow="{{ stats.completion_pct }}" aria-valuemin="0" aria-valuemax="100">
        <div class="progress-fill" style="width: {{ stats.completion_pct }}%"></div>
      </div>
      <span class="muted">{{ stats.done }}/{{ stats.total }} done · {{ stats.completion_pct }}%</span>
    </div>
`],
      tests(code`
def test_stats_counts_total_and_done(client):
    client.patch("/api/tasks/1", json={"done": True})
    data = client.get("/api/stats").get_json()
    assert data["total"] == 3 and data["done"] == 1


def test_stats_completion_pct_is_rounded(client):
    client.patch("/api/tasks/1", json={"done": True})
    assert client.get("/api/stats").get_json()["completion_pct"] == 33.3


def test_stats_with_no_tasks(client):
    acme.TASKS.clear()
    assert client.get("/api/stats").get_json() == {"total": 0, "done": 0, "completion_pct": 0.0}


def test_index_renders_progress_bar(client):
    html = client.get("/").get_data(as_text=True)
    assert 'role="progressbar"' in html
`),
    ],
    red: {
      test_stats_counts_total_and_done: "TypeError: 'NoneType' object is not subscriptable",
      test_stats_completion_pct_is_rounded: "TypeError: 'NoneType' object is not subscriptable",
      test_stats_with_no_tasks: 'assert None == {...}',
      test_index_renders_progress_bar: 'AssertionError',
    },
    heal: [
      {
        failing: [
          {
            name: 'test_stats_with_no_tasks',
            at: 'completion_pct": 0.0',
            trace: [
              'app.py:{stats}: in stats',
              '    return jsonify(compute_stats())',
              'app.py:{pct}: in compute_stats',
              '    pct = round(done / total * 100, 1)',
              'E   ZeroDivisionError: division by zero',
            ],
            lines: { stats: 'return jsonify(compute_stats())', pct: 'pct = round(done / total * 100, 1)' },
            error: 'ZeroDivisionError: division by zero',
            kind: 'ZeroDivisionError',
          },
        ],
        fixes: [
          {
            thought: 'compute_stats() divides by len(TASKS) without a guard. An empty board should report 0.0%, not crash.',
            file: A,
            change: '+1 −1',
            patch: '-    pct = round(done / total * 100, 1)\n+    pct = round(done / total * 100, 1) if total else 0.0',
          },
        ],
      },
    ],
    review: {
      score: 95,
      risk: 'low',
      verdict: 'approve',
      summary: 'Small, focused change with a single source of truth for the numbers. The empty-board edge case is handled and tested. Ready to ship.',
      issues: [
        { severity: 'minor', file: T, message: 'Clamp the inline width to 0–100 in the template to guard against unexpected data.' },
        { severity: 'info', file: A, message: 'compute_stats() is O(n) per request — fine for the in-memory store; cache it if TASKS moves to a database.' },
      ],
    },
    reviewNote: 'Single source of truth for stats · empty list handled · no new dependencies',
    verify: [
      { name: 'Stats endpoint responds', method: 'GET', path: '/api/stats', status: 200, ms: 64, detail: 'total=3 done=0 completion_pct=0.0' },
      { name: 'Completing a task updates stats', method: 'PATCH', path: '/api/tasks/1', status: 200, ms: 71, detail: 'completion_pct=33.3 after update' },
      { name: 'Header renders progress bar', method: 'GET', path: '/', status: 200, ms: 133, detail: 'found role="progressbar"' },
      { name: 'Health check', method: 'GET', path: '/healthz', status: 200, ms: 38, detail: '{"ok": true}' },
    ],
    preview: { stats: true },
  },

  {
    key: 'darkmode',
    match: /dark\s*mode|dark theme|theme toggle|light\/dark/i,
    prompt: "Add a dark mode toggle that remembers the user's choice",
    title: 'Add persistent dark mode toggle',
    summary:
      'Move the palette into CSS custom properties, add a dark theme under [data-theme="dark"], and add an accessible header toggle that stores the choice in localStorage and follows the OS preference on first visit.',
    steps: [
      'Refactor static/style.css colors into CSS custom properties',
      'Add a [data-theme="dark"] palette with accessible contrast',
      'Add a toggle button (aria-label, aria-pressed) to the header',
      'Persist the choice in localStorage and apply it before first paint to avoid a flash',
      'Add rendering tests for the toggle and the dark palette',
    ],
    acceptance: [
      'A header toggle switches between light and dark themes',
      'The choice persists across reloads (localStorage)',
      'First visit follows the OS preference (prefers-color-scheme)',
      'The toggle is keyboard accessible with a descriptive label',
    ],
    risk: 'low',
    estimatedHours: 2,
    commit: 'feat(ui): add persistent dark mode toggle',
    planThought: 'Theme colors are hard-coded in style.css. Converting them to custom properties makes dark mode a variable swap instead of a second stylesheet.',
    codeThought: 'Converting colors to CSS variables, adding the dark palette, then the toggle button and a pre-paint theme script.',
    codeNote: 'Theme is applied before first paint, so returning users never see a light flash',
    edits: [
      [S, '* { box-sizing: border-box; }\n', code`
* { box-sizing: border-box; }

:root {
  --bg: #f7f7f8;
  --surface: #ffffff;
  --text: #1f2328;
  --muted: #6b7280;
  --border: #e5e7eb;
  --accent: #2563eb;
}

[data-theme="dark"] {
  --bg: #0f1115;
  --surface: #181b21;
  --text: #e6e8eb;
  --muted: #9ca3af;
  --border: #2a2f37;
  --accent: #60a5fa;
  color-scheme: dark;
}
`],
      [S, '  background: #f7f7f8;\n  color: #1f2328;\n', '  background: var(--bg);\n  color: var(--text);\n'],
      [S, '  background: #ffffff;\n  border-bottom: 1px solid #e5e7eb;\n', '  background: var(--surface);\n  border-bottom: 1px solid var(--border);\n'],
      [S, '.muted { color: #6b7280; }\n', '.muted { color: var(--muted); }\n'],
      [S, 'background: #2563eb; color: #fff; }\n', 'background: var(--accent); color: #fff; }\n'],
      [S, '  background: #ffffff;\n  border: 1px solid #e5e7eb;\n', '  background: var(--surface);\n  border: 1px solid var(--border);\n'],
      [S, '.assignee { margin-left: auto; color: #6b7280; font-size: 14px; }\n', code`
.assignee { margin-left: auto; color: var(--muted); font-size: 14px; }

.theme-toggle {
  margin-left: auto;
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}
.theme-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
`],
      [T, '  <title>Acme Tasks</title>\n', code`
  <title>Acme Tasks</title>
  <script>
    // Apply the saved (or OS) theme before first paint to avoid a flash.
    (function () {
      var saved = localStorage.getItem("theme");
      var dark = saved ? saved === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    })();
  </script>
`],
      [T, `${COUNT_SPAN}  </header>\n`, code`
    <span class="muted">{{ tasks|length }} tasks</span>
    <button id="theme-toggle" class="theme-toggle" type="button"
            aria-label="Toggle dark mode" aria-pressed="false">Dark mode</button>
  </header>
`],
      [T, '      });\n    });\n  </script>\n', code`
      });
    });

    const toggle = document.getElementById("theme-toggle");
    const syncToggle = () => {
      const dark = document.documentElement.dataset.theme === "dark";
      toggle.setAttribute("aria-pressed", String(dark));
      toggle.textContent = dark ? "Light mode" : "Dark mode";
    };
    toggle.addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      localStorage.setItem("theme", next);
      syncToggle();
    });
    syncToggle();
  </script>
`],
      tests(code`
def test_index_has_theme_toggle(client):
    html = client.get("/").get_data(as_text=True)
    assert 'id="theme-toggle"' in html


def test_theme_toggle_is_accessible(client):
    html = client.get("/").get_data(as_text=True)
    assert 'aria-label="Toggle dark mode"' in html
    assert "aria-pressed=" in html


def test_stylesheet_defines_dark_palette(client):
    css = client.get("/static/style.css").get_data(as_text=True)
    assert '[data-theme="dark"]' in css
`),
    ],
    heal: [
      {
        failing: [
          {
            name: 'test_theme_toggle_is_accessible',
            at: 'aria-pressed=',
            e: [`E       assert 'aria-pressed=' in '<!doctype html>\\n<html lang="en">\\n<head>\\n  <meta charset="utf-8">...'`],
            error: "AssertionError: assert 'aria-pressed=' in '<!doctype html>…'",
            kind: 'AssertionError',
          },
        ],
        fixes: [
          {
            thought: 'The toggle has an aria-label but no aria-pressed state, so assistive tech can’t tell which theme is active. Adding aria-pressed and keeping it in sync.',
            file: T,
            change: '+2 −1',
            patch: '-    <button id="theme-toggle" class="theme-toggle" type="button" aria-label="Toggle dark mode">Dark mode</button>\n+    <button id="theme-toggle" class="theme-toggle" type="button"\n+            aria-label="Toggle dark mode" aria-pressed="false">Dark mode</button>',
          },
        ],
      },
    ],
    review: {
      score: 90,
      risk: 'low',
      verdict: 'approve',
      summary: 'Good refactor: colors now live in custom properties, the toggle is accessible and the pre-paint script avoids a theme flash. One leftover hard-coded color.',
      issues: [
        { severity: 'minor', file: S, message: '.task.done .title still uses a hard-coded #9ca3af; move it to a variable so completed tasks keep contrast in dark mode.' },
        { severity: 'info', file: T, message: 'Consider updating <meta name="theme-color"> alongside data-theme for mobile browser chrome.' },
      ],
    },
    reviewNote: 'No JS dependencies · theme applied before first paint · toggle has aria-pressed',
    verify: [
      { name: 'Theme toggle rendered', method: 'GET', path: '/', status: 200, ms: 128, detail: 'found id="theme-toggle" with aria-pressed' },
      { name: 'Dark palette shipped', method: 'GET', path: '/static/style.css', status: 200, ms: 52, detail: 'found [data-theme="dark"]' },
      { name: 'Choice is persisted', method: 'GET', path: '/', status: 200, ms: 117, detail: 'localStorage.setItem("theme", …) present' },
    ],
    preview: { darkmode: true },
  },

  {
    key: 'duedates',
    match: /due date|overdue|deadline/i,
    prompt: 'Add due dates and highlight overdue tasks in red',
    title: 'Add due dates with overdue highlighting',
    summary:
      'Add an optional ISO due_date to tasks, validate it at the API boundary, expose an `overdue` flag in the JSON, and highlight overdue, unfinished tasks in red with an explicit "Overdue" label.',
    steps: [
      'Add an optional due_date (YYYY-MM-DD) to the Task model',
      'Parse and validate due_date on create and update; malformed dates return 400',
      'Add an overdue flag (due before today and not done) to the JSON representation',
      'Show due dates in the list and highlight overdue tasks in red with an "Overdue" label',
      'Cover parsing, the overdue rule and done tasks with tests',
    ],
    acceptance: [
      'Tasks accept an optional due_date in YYYY-MM-DD format',
      'Malformed dates return 400 with a helpful message',
      'Overdue tasks (due before today, not done) are shown in red with an "Overdue" label',
      'Done tasks are never shown as overdue',
    ],
    risk: 'medium',
    estimatedHours: 3,
    commit: 'feat(tasks): add due dates and overdue highlighting',
    planThought: 'Overdue is a calendar-day rule, so due dates should be stored as plain ISO dates. A to_dict() helper keeps the derived overdue flag out of the dataclass.',
    codeThought: 'Adding due_date to Task, parse_due_date() validation, is_overdue() + to_dict() for the API, and the red highlight in the template.',
    codeNote: 'Overdue rows pair red text with an explicit "Overdue" label, so color is never the only signal',
    edits: [
      [A, 'from datetime import datetime, timezone\n', 'from datetime import date, datetime, timezone\n'],
      [A, '    done: bool = False\n', '    done: bool = False\n    due_date: str | None = None\n'],
      [A, INDEX_FULL, code`
def parse_due_date(value) -> str | None:
    """Accept YYYY-MM-DD (or empty) and return it normalized."""
    if value in (None, ""):
        return None
    try:
        return date.fromisoformat(str(value)).isoformat()
    except ValueError:
        abort(400, description="due_date must be a date in YYYY-MM-DD format")


def is_overdue(task: Task) -> bool:
    return bool(task.due_date) and not task.done and date.fromisoformat(task.due_date) < date.today()


def to_dict(task: Task) -> dict:
    return {**asdict(task), "overdue": is_overdue(task)}


@app.errorhandler(400)
def bad_request(err):
    return jsonify(error=err.description), 400


@app.get("/")
def index():
    tasks = sorted(TASKS.values(), key=lambda t: t.id)
    return render_template("index.html", tasks=tasks, is_overdue=is_overdue)
`],
      [A, '    return jsonify([asdict(t) for t in TASKS.values()])\n', '    return jsonify([to_dict(t) for t in TASKS.values()])\n'],
      [A, `${CREATE_LINE}    TASKS[task.id] = task\n    return jsonify(asdict(task)), 201\n`, code`
    task = Task(
        id=next(_ids),
        title=data.get("title", ""),
        assignee=data.get("assignee"),
        due_date=parse_due_date(data.get("due_date")),
    )
    TASKS[task.id] = task
    return jsonify(to_dict(task)), 201
`],
      [A, '        task.title = data["title"]\n    return jsonify(asdict(task))\n', code`
        task.title = data["title"]
    if "due_date" in data:
        task.due_date = parse_due_date(data["due_date"])
    return jsonify(to_dict(task))
`],
      style(code`
    .due { font-size: 13px; color: #6b7280; }
    .task.overdue { border-color: #f5b5b0; background: #fff5f4; }
    .task.overdue .title, .task.overdue .due { color: #b42318; font-weight: 600; }
`),
      [T, '      <input name="assignee" placeholder="Assignee">\n', '      <input name="assignee" placeholder="Assignee">\n      <input name="due_date" type="date" aria-label="Due date">\n'],
      [T, `      <li class="task {{ 'done' if task.done }}" data-id="{{ task.id }}">\n`, `      <li class="task {{ 'done' if task.done }} {{ 'overdue' if is_overdue(task) }}" data-id="{{ task.id }}">\n`],
      [T, '        <span class="title">{{ task.title }}</span>\n', code`
        <span class="title">{{ task.title }}</span>
        {% if task.due_date %}
        <span class="due">{{ 'Overdue · ' if is_overdue(task) }}due {{ task.due_date }}</span>
        {% endif %}
`],
      tests(code`
def test_create_task_with_due_date(client):
    res = client.post("/api/tasks", json={"title": "Send invoices", "due_date": "2030-01-31"})
    assert res.status_code == 201
    assert res.get_json()["due_date"] == "2030-01-31"


def test_invalid_due_date_returns_400(client):
    res = client.post("/api/tasks", json={"title": "Send invoices", "due_date": "next tuesday"})
    assert res.status_code == 400
    assert "YYYY-MM-DD" in res.get_json()["error"]


def test_overdue_flag_for_past_due_open_task(client):
    res = client.post("/api/tasks", json={"title": "File taxes", "due_date": "2020-04-15"})
    assert res.get_json()["overdue"] is True


def test_done_task_is_never_overdue(client):
    task_id = client.post("/api/tasks", json={"title": "File taxes", "due_date": "2020-04-15"}).get_json()["id"]
    res = client.patch(f"/api/tasks/{task_id}", json={"done": True})
    assert res.get_json()["overdue"] is False
`),
    ],
    heal: [
      {
        failing: [
          {
            name: 'test_overdue_flag_for_past_due_open_task',
            at: 'res = client.post',
            trace: [
              'app.py:{create}: in create_task',
              '    return jsonify(to_dict(task)), 201',
              'app.py:{overdue}: in is_overdue',
              '    return bool(task.due_date) and not task.done and datetime.fromisoformat(task.due_date) < datetime.now(timezone.utc)',
              "E   TypeError: can't compare offset-naive and offset-aware datetimes",
            ],
            lines: { create: 'return jsonify(to_dict(task)), 201', overdue: 'return bool(task.due_date)' },
            error: "TypeError: can't compare offset-naive and offset-aware datetimes",
            kind: 'TypeError',
          },
          {
            name: 'test_done_task_is_never_overdue',
            at: 'task_id = client.post',
            e: ["E       TypeError: can't compare offset-naive and offset-aware datetimes"],
            error: "TypeError: can't compare offset-naive and offset-aware datetimes",
            kind: 'TypeError',
          },
        ],
        fixes: [
          {
            thought: 'is_overdue() compares a naive datetime parsed from the due date with an aware datetime.now(timezone.utc). Overdue is a calendar-day rule, so compare date objects instead.',
            file: A,
            change: '+1 −1',
            patch: '-    return bool(task.due_date) and not task.done and datetime.fromisoformat(task.due_date) < datetime.now(timezone.utc)\n+    return bool(task.due_date) and not task.done and date.fromisoformat(task.due_date) < date.today()',
          },
        ],
      },
    ],
    review: {
      score: 86,
      risk: 'medium',
      verdict: 'approve',
      summary:
        'Solid implementation with good validation and tests. The overdue rule uses the container clock, which is UTC on Cloud Run — acceptable for now, but worth a follow-up for users in other timezones.',
      issues: [
        { severity: 'major', file: A, message: 'date.today() uses the container clock (UTC on Cloud Run). Users west of UTC may see tasks flagged overdue up to a day early; consider computing overdue in the user’s timezone.' },
        { severity: 'info', file: T, message: 'Overdue rows pair red with an explicit "Overdue" label — good accessibility.' },
      ],
    },
    reviewNote: 'Input validated · derived overdue flag kept out of storage · timezone caveat noted',
    verify: [
      { name: 'Past due date flags overdue', method: 'POST', path: '/api/tasks', status: 201, ms: 91, detail: 'overdue=true for due_date 2020-04-15' },
      { name: 'Malformed due date is rejected', method: 'POST', path: '/api/tasks', status: 400, ms: 77, detail: 'error: due_date must be a date in YYYY-MM-DD format' },
      { name: 'Overdue rows are highlighted', method: 'GET', path: '/', status: 200, ms: 139, detail: 'found "Overdue · due" label on a red row' },
      { name: 'Health check', method: 'GET', path: '/healthz', status: 200, ms: 40, detail: '{"ok": true}' },
    ],
    preview: { duedates: true },
  },

  {
    key: 'validation',
    match: /empty title|blank title|title.*(400|required|empty|blank)|(400|required|empty|blank).*title|validat\w* (the )?title/i,
    prompt: 'Fix: creating a task with an empty title should return 400 with a helpful error',
    title: 'Reject blank task titles with a helpful 400',
    summary:
      'POST /api/tasks currently accepts empty or whitespace-only titles and stores blank tasks. Validate titles in one helper, return 400 with a JSON error that explains the rule, apply the same rule to renames, and surface the message in the form.',
    steps: [
      'Add clean_title() that trims whitespace and enforces 1–200 characters',
      'Use it in POST /api/tasks and PATCH /api/tasks/<id>; return 400 {"error": …} when invalid',
      'Show the API error message under the new-task form',
      'Add regression tests for empty, whitespace-only and renamed titles',
    ],
    acceptance: [
      'POST /api/tasks with an empty or whitespace-only title returns 400',
      'The error body explains the rule: {"error": "title is required (1-200 characters)"}',
      'Renaming a task to a blank title is rejected the same way',
      'Valid titles are trimmed before saving',
    ],
    risk: 'low',
    estimatedHours: 1.5,
    commit: 'fix(api): reject blank task titles with a helpful 400',
    planThought: 'The bug is in create_task(): it stores data.get("title", "") unvalidated. PATCH has the same hole, so one shared validator fixes both.',
    codeThought: 'Adding clean_title() + TITLE_ERROR, guarding POST, then surfacing the error message in the form.',
    codeNote: 'Errors are JSON ({"error": …}) so the dashboard and API clients can show them verbatim',
    edits: [
      [A, INDEX_DEF, code`
MAX_TITLE = 200
TITLE_ERROR = f"title is required (1-{MAX_TITLE} characters)"


def clean_title(raw) -> str | None:
    """Return a trimmed title, or None if it is blank or too long."""
    title = raw.strip() if isinstance(raw, str) else ""
    return title if 0 < len(title) <= MAX_TITLE else None


${INDEX_DEF}`],
      [A, CREATE_LINE, code`
    title = clean_title(data.get("title"))
    if title is None:
        return jsonify(error=TITLE_ERROR), 400
    task = Task(id=next(_ids), title=title, assignee=data.get("assignee"))
`],
      [A, '    if "title" in data:\n        task.title = data["title"]\n', code`
    if "title" in data:
        title = clean_title(data["title"])
        if title is None:
            return jsonify(error=TITLE_ERROR), 400
        task.title = title
`],
      [T, '      <button type="submit">Add task</button>\n    </form>\n', '      <button type="submit">Add task</button>\n    </form>\n    <p id="form-error" class="error" role="alert"></p>\n'],
      [T, '      if (res.ok) location.reload();\n', code`
      if (res.ok) return location.reload();
      const { error } = await res.json();
      document.getElementById("form-error").textContent = error;
`],
      style('    .error { color: #b42318; font-size: 14px; margin: -8px 0 12px; min-height: 1em; }\n'),
      tests(code`
def test_create_task_with_empty_title_returns_400(client):
    res = client.post("/api/tasks", json={"title": ""})
    assert res.status_code == 400
    assert res.get_json() == {"error": "title is required (1-200 characters)"}


def test_create_task_with_whitespace_title_returns_400(client):
    assert client.post("/api/tasks", json={"title": "   "}).status_code == 400


def test_create_task_trims_title(client):
    res = client.post("/api/tasks", json={"title": "  Ship v2  "})
    assert res.get_json()["title"] == "Ship v2"


def test_rename_to_blank_title_returns_400(client):
    res = client.patch("/api/tasks/2", json={"title": "  "})
    assert res.status_code == 400
`),
    ],
    red: {
      test_create_task_with_empty_title_returns_400: 'assert 201 == 400',
      test_create_task_with_whitespace_title_returns_400: 'assert 201 == 400',
      test_create_task_trims_title: "AssertionError: assert '  Ship v2  ' == 'Ship v2'",
      test_rename_to_blank_title_returns_400: 'assert 200 == 400',
    },
    heal: [
      {
        failing: [
          {
            name: 'test_rename_to_blank_title_returns_400',
            at: 'assert res.status_code == 400',
            e: ['E       assert 200 == 400', 'E        +  where 200 = <WrapperTestResponse streamed [200 OK]>.status_code'],
            error: 'assert 200 == 400',
            kind: 'AssertionError',
          },
        ],
        fixes: [
          {
            thought: 'PATCH /api/tasks/<id> still assigns the raw title, so renames bypass validation. Reusing clean_title() there too.',
            file: A,
            change: '+4 −1',
            patch: '     if "title" in data:\n-        task.title = data["title"]\n+        title = clean_title(data["title"])\n+        if title is None:\n+            return jsonify(error=TITLE_ERROR), 400\n+        task.title = title',
          },
        ],
      },
    ],
    review: {
      score: 96,
      risk: 'low',
      verdict: 'approve',
      summary: 'Correct, minimal fix with regression tests for every path. One ordering nit in update_task().',
      issues: [
        { severity: 'minor', file: A, message: 'update_task() applies `done` before validating `title`, so PATCH {"done": true, "title": ""} returns 400 but still marks the task done. Validate before mutating.' },
        { severity: 'info', file: A, message: 'Consider a machine-readable error code (e.g. "code": "title_invalid") alongside the message.' },
      ],
    },
    reviewNote: 'Regression tests for every path · error message is user-facing and actionable',
    verify: [
      { name: 'Empty title is rejected', method: 'POST', path: '/api/tasks', status: 400, ms: 72, detail: 'error: title is required (1-200 characters)' },
      { name: 'Whitespace-only title is rejected', method: 'POST', path: '/api/tasks', status: 400, ms: 69, detail: 'error: title is required (1-200 characters)' },
      { name: 'Valid title is trimmed', method: 'POST', path: '/api/tasks', status: 201, ms: 84, detail: 'title saved as "Ship v2"' },
      { name: 'Home page still renders', method: 'GET', path: '/', status: 200, ms: 121, detail: '3 seeded tasks listed' },
    ],
    preview: { validation: true },
  },

  {
    key: 'search',
    match: /search|filter (the )?(task )?list/i,
    prompt: 'Add a search box that filters the task list by title as you type',
    title: 'Add instant title search to the task list',
    summary:
      'Add a labelled search box above the list that filters tasks client-side as you type, plus an optional ?q= filter on GET /api/tasks for API clients.',
    steps: [
      'Support ?q= (case-insensitive substring match on title) on GET /api/tasks',
      'Add a labelled search input above the task list',
      'Filter visible rows on input without reloading the page',
      'Test API filtering, case-insensitivity and the rendered input',
    ],
    acceptance: [
      'GET /api/tasks?q=roadmap returns only matching tasks',
      'Matching is case-insensitive',
      'The page has a labelled search box that filters the list instantly',
    ],
    risk: 'low',
    estimatedHours: 2.5,
    commit: 'feat(ui): add instant title search',
    planThought: 'Filtering belongs on both sides: a ?q= parameter for API clients and a tiny client-side filter so typing feels instant.',
    codeThought: 'Adding the ?q= filter to list_tasks(), then the search input and an input handler that hides non-matching rows.',
    codeNote: 'Client-side filter keeps typing instant; the API filter serves integrations',
    edits: [
      [A, '    return jsonify([asdict(t) for t in TASKS.values()])\n', code`
    query = request.args.get("q", "").strip().lower()
    tasks = [t for t in TASKS.values() if query in t.title.lower()]
    return jsonify([asdict(t) for t in tasks])
`],
      style('    .search { width: 100%; padding: 8px 10px; margin-bottom: 12px; border: 1px solid #d1d5db; border-radius: 6px; }\n'),
      [T, '    <ul class="task-list">\n', code`
    <input id="search" class="search" type="search" placeholder="Search tasks…"
           aria-label="Search tasks" autocomplete="off">

    <ul class="task-list">
`],
      [T, SCRIPT_OPEN, code`
  <script>
    document.getElementById("search").addEventListener("input", (event) => {
      const query = event.target.value.trim().toLowerCase();
      document.querySelectorAll(".task").forEach((row) => {
        const title = row.querySelector(".title").textContent.toLowerCase();
        row.hidden = !title.includes(query);
      });
    });

`],
      tests(code`
def test_list_tasks_filters_by_query(client):
    data = client.get("/api/tasks?q=roadmap").get_json()
    assert [t["title"] for t in data] == ["Draft Q3 roadmap"]


def test_list_tasks_query_is_case_insensitive(client):
    data = client.get("/api/tasks?q=q3").get_json()
    assert len(data) == 1


def test_index_has_search_box(client):
    html = client.get("/").get_data(as_text=True)
    assert 'aria-label="Search tasks"' in html
`),
    ],
    heal: [
      {
        failing: [
          {
            name: 'test_list_tasks_query_is_case_insensitive',
            at: 'assert len(data) == 1',
            e: ['E       assert 0 == 1', 'E        +  where 0 = len([])'],
            error: 'assert 0 == 1',
            kind: 'AssertionError',
          },
        ],
        fixes: [
          {
            thought: 'The query is lower-cased but titles are not, so "q3" never matches "Draft Q3 roadmap". Lower-casing both sides.',
            file: A,
            change: '+1 −1',
            patch: '-    tasks = [t for t in TASKS.values() if query in t.title]\n+    tasks = [t for t in TASKS.values() if query in t.title.lower()]',
          },
        ],
      },
    ],
    review: {
      score: 94,
      risk: 'low',
      verdict: 'approve',
      summary: 'Simple and effective. Both API and UI paths are covered by tests and the input is properly labelled.',
      issues: [{ severity: 'info', file: T, message: 'No debounce needed at this list size; revisit if the list is server-paginated later.' }],
    },
    reviewNote: 'Labelled input · no new dependencies · API and UI share the same matching rule',
    verify: [
      { name: 'API filter matches case-insensitively', method: 'GET', path: '/api/tasks?q=ROADMAP', status: 200, ms: 58, detail: '1 match: "Draft Q3 roadmap"' },
      { name: 'No matches returns empty list', method: 'GET', path: '/api/tasks?q=zzz', status: 200, ms: 51, detail: '0 matches' },
      { name: 'Search box rendered', method: 'GET', path: '/', status: 200, ms: 126, detail: 'found aria-label="Search tasks"' },
      { name: 'Health check', method: 'GET', path: '/healthz', status: 200, ms: 37, detail: '{"ok": true}' },
    ],
    preview: { search: true },
  },

  {
    key: 'assignees',
    match: /per (person|assignee)|each person|assignee counts?|open tasks (each|per)|workload/i,
    prompt: 'Show how many open tasks each person has in the header',
    title: 'Show open task counts per assignee',
    summary: 'Count open (not done) tasks per assignee and show them as compact pills in the header, busiest first, so the team can spot who is overloaded.',
    steps: [
      'Add open_counts() using collections.Counter, excluding done tasks',
      'Group tasks without an assignee under "unassigned"',
      'Render one pill per person in the header, busiest first',
      'Test counting, grouping and rendering',
    ],
    acceptance: [
      'The header shows one pill per assignee with their open task count',
      'Done tasks are excluded from the counts',
      'Tasks without an assignee are grouped as "unassigned"',
    ],
    risk: 'low',
    estimatedHours: 2,
    commit: 'feat(ui): show open task counts per assignee',
    planThought: 'A Counter over open tasks gives the numbers in one pass; most_common() already sorts busiest first.',
    codeThought: 'Adding open_counts() and rendering the pills in the header.',
    codeNote: 'Pills are a labelled list, so screen readers announce "Open tasks per person"',
    edits: [
      [A, 'import itertools\n', 'import itertools\nfrom collections import Counter\n'],
      [A, INDEX_FULL, code`
def open_counts() -> list[tuple[str, int]]:
    """Open (not done) tasks per assignee, busiest first."""
    counts = Counter(t.assignee or "unassigned" for t in TASKS.values() if not t.done)
    return counts.most_common()


@app.get("/")
def index():
    tasks = sorted(TASKS.values(), key=lambda t: t.id)
    return render_template("index.html", tasks=tasks, open_counts=open_counts())
`],
      style(code`
    .load { display: flex; gap: 6px; margin: 0 0 0 auto; padding: 0; list-style: none; }
    .pill { font-size: 12px; padding: 3px 10px; border-radius: 999px; background: #eef2ff; color: #3730a3; }
`),
      [T, COUNT_SPAN, code`
    <span class="muted">{{ tasks|length }} tasks</span>
    <ul class="load" aria-label="Open tasks per person">
      {% for who, count in open_counts %}
      <li class="pill">{{ who }} <strong>{{ count }}</strong></li>
      {% endfor %}
    </ul>
`],
      tests(code`
def test_open_counts_excludes_done_tasks(client):
    client.patch("/api/tasks/1", json={"done": True})
    assert dict(acme.open_counts()) == {"dev": 1, "sam": 1}


def test_open_counts_groups_unassigned(client):
    client.post("/api/tasks", json={"title": "Triage inbox"})
    assert dict(acme.open_counts())["unassigned"] == 1


def test_index_renders_load_pills(client):
    html = client.get("/").get_data(as_text=True)
    assert 'aria-label="Open tasks per person"' in html
`),
    ],
    heal: [
      {
        failing: [
          {
            name: 'test_open_counts_groups_unassigned',
            at: '["unassigned"] == 1',
            e: ["E       KeyError: 'unassigned'"],
            error: "KeyError: 'unassigned'",
            kind: 'KeyError',
          },
        ],
        fixes: [
          {
            thought: 'Unassigned tasks were counted under None. Grouping them under "unassigned" so they show up as a pill.',
            file: A,
            change: '+1 −1',
            patch: '-    counts = Counter(t.assignee for t in TASKS.values() if not t.done)\n+    counts = Counter(t.assignee or "unassigned" for t in TASKS.values() if not t.done)',
          },
        ],
      },
    ],
    review: {
      score: 93,
      risk: 'low',
      verdict: 'approve',
      summary: 'Tidy use of Counter.most_common(); counts exclude done tasks and unassigned work is visible. Good to go.',
      issues: [{ severity: 'info', file: T, message: 'With many assignees the pills could wrap; consider capping to the top five plus “+N”.' }],
    },
    reviewNote: 'Single pass over tasks · labelled list markup · no new dependencies',
    verify: [
      { name: 'Header shows load pills', method: 'GET', path: '/', status: 200, ms: 131, detail: 'found 3 pills: maya 1 · dev 1 · sam 1' },
      { name: 'Completing a task updates counts', method: 'PATCH', path: '/api/tasks/1', status: 200, ms: 66, detail: 'maya dropped to 0 open' },
      { name: 'Health check', method: 'GET', path: '/healthz', status: 200, ms: 39, detail: '{"ok": true}' },
    ],
    preview: { assignees: true },
  },

  {
    key: 'shortcut',
    match: /shortcut|hotkey|keyboard|press n\b/i,
    prompt: 'Press N anywhere to focus the new task input, and show the shortcut hint',
    title: "Add 'N' keyboard shortcut for new tasks",
    summary: 'Add a global keydown handler that focuses the new-task input when N is pressed (ignored while typing in a field or with modifiers) and advertise it in the placeholder and aria-keyshortcuts.',
    steps: [
      'Add a keydown listener that focuses the title input on N',
      'Ignore the shortcut while typing in inputs or with modifier keys',
      'Advertise the shortcut via the placeholder and aria-keyshortcuts',
      'Test the rendered hint and attribute',
    ],
    acceptance: [
      'Pressing N outside a text field focuses the new-task input',
      'Typing an "n" inside any field is unaffected',
      'The shortcut is discoverable (placeholder + aria-keyshortcuts)',
    ],
    risk: 'low',
    estimatedHours: 1,
    commit: 'feat(ui): add N shortcut to focus the new-task input',
    planThought: 'Pure front-end change. The main risk is hijacking normal typing, so the handler must bail out inside form fields and on modifier keys.',
    codeThought: 'Adding the keydown handler with a guard for editable targets, then the hint in the placeholder.',
    codeNote: 'Shortcut ignores modifier keys, so Cmd+N / Ctrl+N still open a new window',
    edits: [
      [T, '      <input name="title" placeholder="What needs doing?" autocomplete="off" required>\n', code`
      <input name="title" placeholder="What needs doing? (press N)" autocomplete="off" required
             aria-keyshortcuts="n">
`],
      [T, SCRIPT_OPEN, code`
  <script>
    // Press N anywhere (outside a text field) to jump to the new-task input.
    document.addEventListener("keydown", (event) => {
      const typing = event.target.closest("input, textarea, select, [contenteditable]");
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "n" || event.key === "N") {
        event.preventDefault();
        document.querySelector('#new-task input[name="title"]').focus();
      }
    });

`],
      tests(code`
def test_title_input_declares_shortcut(client):
    html = client.get("/").get_data(as_text=True)
    assert 'aria-keyshortcuts="n"' in html


def test_shortcut_hint_rendered(client):
    html = client.get("/").get_data(as_text=True)
    assert "(press N)" in html
`),
    ],
    heal: [
      {
        failing: [
          {
            name: 'test_shortcut_hint_rendered',
            at: '"(press N)" in html',
            e: [`E       assert '(press N)' in '<!doctype html>\\n<html lang="en">\\n<head>\\n  <meta charset="utf-8">...'`],
            error: "AssertionError: assert '(press N)' in '<!doctype html>…'",
            kind: 'AssertionError',
          },
        ],
        fixes: [
          {
            thought: 'The placeholder says "Press N to add" but the agreed hint is "(press N)". Matching the acceptance wording.',
            file: T,
            change: '+1 −1',
            patch: '-      <input name="title" placeholder="What needs doing? Press N to add" autocomplete="off" required\n+      <input name="title" placeholder="What needs doing? (press N)" autocomplete="off" required',
          },
        ],
      },
    ],
    review: {
      score: 91,
      risk: 'low',
      verdict: 'approve',
      summary: 'Careful handler: editable targets and modifier keys are excluded, and the shortcut is exposed to assistive tech via aria-keyshortcuts.',
      issues: [{ severity: 'minor', file: T, message: 'Consider a visible “N” keycap hint for sighted keyboard users; the placeholder disappears once text is entered.' }],
    },
    reviewNote: 'Front-end only · no API surface changes · accessible shortcut metadata',
    verify: [
      { name: 'Shortcut hint rendered', method: 'GET', path: '/', status: 200, ms: 118, detail: 'found "(press N)" placeholder' },
      { name: 'aria-keyshortcuts declared', method: 'GET', path: '/', status: 200, ms: 109, detail: 'found aria-keyshortcuts="n"' },
      { name: 'Health check', method: 'GET', path: '/healthz', status: 200, ms: 36, detail: '{"ok": true}' },
    ],
    preview: { shortcut: true },
  },

  {
    key: 'avatars',
    match: /avatar|initials/i,
    prompt: 'Replace the @assignee text with colored avatar initials',
    title: 'Show assignees as avatar initials',
    summary: 'Replace the "@name" label with a colored circular avatar showing the assignee’s initial, with the full name in a tooltip and aria-label.',
    steps: [
      'Render a circular avatar with the first initial instead of "@name"',
      'Derive a stable hue per assignee so colors stay consistent',
      'Keep the full name available via title and aria-label',
      'Test avatar rendering for assigned and unassigned tasks',
    ],
    acceptance: [
      'Each task shows a colored avatar with the assignee’s initial',
      'The full name is available on hover and to screen readers',
      'Unassigned tasks show a neutral placeholder avatar',
    ],
    risk: 'low',
    estimatedHours: 1.5,
    commit: 'feat(ui): show assignees as avatar initials',
    planThought: 'Template-only change. A stable hue derived from the name keeps each person’s color consistent between page loads.',
    codeThought: 'Swapping the @assignee span for an avatar with a derived hue and an accessible label.',
    codeNote: 'Avatar hue is derived from the name, so colors are stable across reloads',
    edits: [
      [T, `        <span class="assignee">@{{ task.assignee or 'unassigned' }}</span>\n`, code`
        {% set who = task.assignee or "unassigned" %}
        <span class="avatar" title="{{ who }}" aria-label="Assigned to {{ who }}"
              style="background: hsl({{ who|length * 47 % 360 }} 70% 42%)">{{ who[:1]|upper }}</span>
`],
      style(code`
    .avatar {
      margin-left: auto;
      display: inline-grid;
      place-items: center;
      width: 26px;
      height: 26px;
      border-radius: 50%;
      color: #fff;
      font-size: 12px;
      font-weight: 700;
    }
`),
      tests(code`
def test_index_renders_assignee_avatar(client):
    html = client.get("/").get_data(as_text=True)
    assert 'aria-label="Assigned to maya"' in html


def test_unassigned_task_shows_placeholder_avatar(client):
    client.post("/api/tasks", json={"title": "Triage inbox"})
    html = client.get("/").get_data(as_text=True)
    assert 'aria-label="Assigned to unassigned"' in html
`),
    ],
    heal: [
      {
        failing: [
          {
            name: 'test_unassigned_task_shows_placeholder_avatar',
            at: 'Assigned to unassigned',
            e: [`E       assert 'aria-label="Assigned to unassigned"' in '<!doctype html>\\n<html lang="en">...'`],
            error: 'AssertionError',
            kind: 'AssertionError',
          },
        ],
        fixes: [
          {
            thought: 'Unassigned tasks rendered aria-label="Assigned to None". Falling back to "unassigned" before rendering.',
            file: T,
            change: '+1 −1',
            patch: '-        {% set who = task.assignee %}\n+        {% set who = task.assignee or "unassigned" %}',
          },
        ],
      },
    ],
    review: {
      score: 84,
      risk: 'low',
      verdict: 'approve',
      summary: 'Works as specified and stays accessible, but initials alone make ownership harder to scan than names. Worth a design check before release.',
      issues: [
        { severity: 'minor', file: T, message: 'Initials hide who owns a task at a glance (two people share “M”); consider keeping the name visible on wide screens.' },
        { severity: 'info', file: T, message: 'White text on the derived hues passes 4.5:1 at 42% lightness.' },
      ],
    },
    reviewNote: 'Template-only change · accessible names preserved',
    verify: [
      { name: 'Avatars rendered', method: 'GET', path: '/', status: 200, ms: 124, detail: 'found 3 avatars with aria-labels' },
      { name: 'Unassigned placeholder', method: 'POST', path: '/api/tasks', status: 201, ms: 81, detail: 'new task shows "U" placeholder avatar' },
      { name: 'Health check', method: 'GET', path: '/healthz', status: 200, ms: 35, detail: '{"ok": true}' },
    ],
    preview: { avatars: true },
  },

  {
    key: 'csv',
    match: /\bcsv\b|export/i,
    prompt: 'Add CSV export of all tasks at /export.csv',
    title: 'Add CSV export endpoint',
    summary: 'Stream all tasks as CSV from GET /export.csv using the csv module, with a download filename and an "Export CSV" link in the header.',
    steps: [
      'Add GET /export.csv that writes tasks with csv.writer',
      'Set Content-Disposition so browsers download tasks.csv',
      'Escape commas and quotes in titles correctly',
      'Add an "Export CSV" link to the header and tests',
    ],
    acceptance: [
      'GET /export.csv returns text/csv with a header row',
      'The response downloads as tasks.csv',
      'Titles containing commas or quotes are escaped per RFC 4180',
    ],
    risk: 'low',
    estimatedHours: 2,
    commit: 'feat(api): add CSV export',
    planThought: 'The csv module handles quoting; the endpoint just needs the right mimetype and a download filename.',
    codeThought: 'Adding the /export.csv route with csv.writer and an Export link in the header.',
    codeNote: 'Export streams from memory; fine for the in-memory store',
    edits: [
      [A, 'import itertools\n', 'import csv\nimport io\nimport itertools\n'],
      [A, 'from flask import Flask, abort, jsonify, render_template, request\n', 'from flask import Flask, Response, abort, jsonify, render_template, request\n'],
      [A, '@app.get("/healthz")\n', code`
@app.get("/export.csv")
def export_csv():
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["id", "title", "assignee", "done", "created_at"])
    for task in sorted(TASKS.values(), key=lambda t: t.id):
        writer.writerow([task.id, task.title, task.assignee or "", task.done, task.created_at])
    return Response(
        buf.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=tasks.csv"},
    )


@app.get("/healthz")
`],
      [T, COUNT_SPAN, `${COUNT_SPAN}    <a class="export" href="/export.csv" download>Export CSV</a>\n`],
      tests(code`
def test_export_csv_returns_csv(client):
    res = client.get("/export.csv")
    assert res.mimetype == "text/csv"
    assert res.get_data(as_text=True).startswith("id,title,assignee,done,created_at")


def test_export_csv_sets_download_filename(client):
    res = client.get("/export.csv")
    assert "filename=tasks.csv" in res.headers["Content-Disposition"]


def test_export_csv_escapes_quotes(client):
    client.post("/api/tasks", json={"title": 'Say "hi", team'})
    body = client.get("/export.csv").get_data(as_text=True)
    assert '"Say ""hi"", team"' in body
`),
    ],
    heal: [
      {
        failing: [
          {
            name: 'test_export_csv_sets_download_filename',
            at: 'Content-Disposition',
            e: ["E       KeyError: 'Content-Disposition'"],
            error: "KeyError: 'Content-Disposition'",
            kind: 'KeyError',
          },
          {
            name: 'test_export_csv_escapes_quotes',
            at: `assert '"Say`,
            e: [`E       assert '"Say ""hi"", team"' in 'id,title,assignee,done,created_at\\r\\n...4,Say \\\\"hi\\\\"\\\\, team,,False,...'`],
            error: 'AssertionError: quotes escaped with backslashes',
            kind: 'AssertionError',
          },
        ],
        fixes: [
          {
            thought: 'The response is missing Content-Disposition, and csv.writer was configured with QUOTE_NONE + a backslash escapechar. Adding the header and switching to the default RFC 4180 quoting.',
            file: A,
            change: '+4 −1',
            patch: '-    writer = csv.writer(buf, quoting=csv.QUOTE_NONE, escapechar="\\\\")\n+    writer = csv.writer(buf)',
          },
        ],
      },
    ],
    review: {
      score: 89,
      risk: 'low',
      verdict: 'approve',
      summary: 'Uses the standard library correctly; quoting now follows RFC 4180.',
      issues: [{ severity: 'minor', file: A, message: 'Prefix values starting with =, +, - or @ to avoid CSV formula injection when opened in spreadsheets.' }],
    },
    reviewNote: 'Standard library only · RFC 4180 quoting',
    verify: [
      { name: 'CSV export downloads', method: 'GET', path: '/export.csv', status: 200, ms: 62, detail: 'text/csv · filename=tasks.csv' },
      { name: 'Header row present', method: 'GET', path: '/export.csv', status: 200, ms: 55, detail: 'id,title,assignee,done,created_at' },
      { name: 'Health check', method: 'GET', path: '/healthz', status: 200, ms: 38, detail: '{"ok": true}' },
    ],
    preview: { csv: true },
  },
]

// A CSV attempt that never went green (used for the "failed" demo task).
export const FAILED_CSV = {
  ...SCENARIOS.find((s) => s.key === 'csv'),
  key: 'csv_failed',
  match: null,
  edits: SCENARIOS.find((s) => s.key === 'csv').edits.map((e) =>
    e[0] === A && e[1] === '@app.get("/healthz")\n'
      ? [A, e[1], e[2].replace('writer = csv.writer(buf)', 'writer = csv.writer(buf, quoting=csv.QUOTE_NONE, escapechar="\\\\")')]
      : e,
  ),
  failAfter: 3,
  heal: [
    {
      failing: SCENARIOS.find((s) => s.key === 'csv').heal[0].failing,
      fixes: [
        {
          thought: 'The response is missing Content-Disposition. Adding attachment; filename=tasks.csv.',
          file: A,
          change: '+3 −1',
          patch: '-    return Response(buf.getvalue(), mimetype="text/csv")\n+    return Response(\n+        buf.getvalue(),\n+        mimetype="text/csv",\n+        headers={"Content-Disposition": "attachment; filename=tasks.csv"},\n+    )',
        },
        {
          thought: 'Quotes come out as \\" — trying a different escapechar while keeping QUOTE_NONE.',
          file: A,
          change: '+1 −1',
          patch: '-    writer = csv.writer(buf, quoting=csv.QUOTE_NONE)\n+    writer = csv.writer(buf, quoting=csv.QUOTE_NONE, escapechar="\\\\")',
        },
      ],
    },
    {
      failing: SCENARIOS.find((s) => s.key === 'csv').heal[0].failing.slice(1),
      fixes: [
        {
          thought: 'Still escaping instead of doubling quotes. Pre-escaping quotes in titles before writing the row.',
          file: A,
          change: '+2 −1',
          patch: '+        title = task.title.replace(\'"\', \'""\')\n-        writer.writerow([task.id, task.title, task.assignee or "", task.done, task.created_at])\n+        writer.writerow([task.id, title, task.assignee or "", task.done, task.created_at])',
        },
      ],
    },
    { failing: SCENARIOS.find((s) => s.key === 'csv').heal[0].failing.slice(1), fixes: [] },
  ],
}

// ---------------------------------------------------------------------------
// Generic fallback for free-form prompts
// ---------------------------------------------------------------------------
const STOP_FIELDS = new Set(['ability', 'option', 'way', 'button', 'page', 'feature', 'new', 'support', 'link', 'section', 'view', 'screen', 'modal', 'endpoint', 'api', 'route'])

export function deriveTitle(prompt) {
  let s = String(prompt || '').replace(/\s+/g, ' ').trim()
  s = s.replace(/^(please|pls|can you|could you|i want to|we need to|let'?s|i'?d like to)\s+/i, '')
  s = s.split(/(?<=[.!?])\s/)[0].replace(/[.!?:;,]+$/, '')
  if (s.length > 60) s = `${s.slice(0, 58).replace(/\s+\S*$/, '')}…`
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Requested change'
}

function extractField(prompt) {
  const res = [
    /\b(?:add|support|store|track|record|capture)\s+(?:an?\s+|the\s+)?(?:optional\s+)?([a-z][a-z-]*(?:\s[a-z][a-z-]*)?)\s+(?:field|column|attribute|property)\b/i,
    /\b(?:add|support|attach)\s+(?:an?\s+|the\s+)?(?:optional\s+)?([a-z][a-z-]*(?:\s[a-z][a-z-]*)?)\s+(?:to|on|for)\s+(?:each\s+|every\s+|all\s+)?tasks?\b/i,
  ]
  for (const re of res) {
    const m = String(prompt).match(re)
    if (m) {
      const words = m[1].toLowerCase().split(/\s+/).filter((w) => !STOP_FIELDS.has(w))
      if (words.length) return words.join('_').replace(/-/g, '_')
    }
  }
  return null
}

const label = (field) => field.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

export function genericScenario(prompt) {
  const title = deriveTitle(prompt)
  const field = extractField(prompt)
  const base = {
    key: field ? `field:${field}` : 'generic',
    prompt,
    title,
    risk: 'low',
    estimatedHours: 2,
    planThought: 'The change is contained: model + API in app.py, rendering in templates/index.html, and tests alongside the existing suite.',
    reviewNote: 'Scoped change · no new dependencies · tests cover the new behaviour',
  }
  if (field) {
    const L = label(field)
    return {
      ...base,
      title: `Add ${field.replace(/_/g, ' ')} to tasks`,
      summary: `Add an optional \`${field}\` to tasks, accept it on create and update, and show it next to each task in the list.`,
      steps: [
        `Add an optional ${field} attribute to the Task dataclass`,
        `Accept ${field} on POST /api/tasks and PATCH /api/tasks/<id>`,
        `Show ${L.toLowerCase()} next to each task and add an input to the form`,
        'Cover the API and rendering with pytest',
      ],
      acceptance: [
        `Tasks accept an optional ${field} on create and update`,
        `The JSON API returns ${field} (null when unset)`,
        `The task list shows ${L.toLowerCase()} when present`,
        'All existing tests keep passing',
      ],
      commit: `feat(tasks): add ${field} to tasks`,
      codeThought: `Adding ${field} to the Task dataclass, wiring it through create/update, then rendering it in the list.`,
      codeNote: `${L} is optional, so existing tasks and API clients are unaffected`,
      edits: [
        [A, '    done: bool = False\n', `    done: bool = False\n    ${field}: str | None = None\n`],
        [A, CREATE_LINE, `    task = Task(\n        id=next(_ids),\n        title=data.get("title", ""),\n        assignee=data.get("assignee"),\n        ${field}=data.get("${field}") or None,\n    )\n`],
        [A, '        task.title = data["title"]\n', `        task.title = data["title"]\n    if "${field}" in data:\n        task.${field} = data["${field}"] or None\n`],
        [T, '      <input name="assignee" placeholder="Assignee">\n', `      <input name="assignee" placeholder="Assignee">\n      <input name="${field}" placeholder="${L}">\n`],
        [T, '        <span class="title">{{ task.title }}</span>\n', `        <span class="title">{{ task.title }}</span>\n        {% if task.${field} %}<span class="meta">${L}: {{ task.${field} }}</span>{% endif %}\n`],
        style('    .meta { font-size: 13px; color: #6b7280; }\n'),
        tests(
          `def test_create_task_with_${field}(client):\n    res = client.post("/api/tasks", json={"title": "Plan sprint", "${field}": "example"})\n    assert res.get_json()["${field}"] == "example"\n\n\n` +
            `def test_${field}_defaults_to_none(client):\n    res = client.post("/api/tasks", json={"title": "Plan sprint"})\n    assert res.get_json()["${field}"] is None\n\n\n` +
            `def test_index_renders_${field}(client):\n    client.post("/api/tasks", json={"title": "Plan sprint", "${field}": "example"})\n    html = client.get("/").get_data(as_text=True)\n    assert "${L}: example" in html\n`,
        ),
      ],
      heal: [
        {
          failing: [
            {
              name: `test_index_renders_${field}`,
              at: `"${L}: example" in html`,
              e: [`E       assert '${L}: example' in '<!doctype html>\\n<html lang="en">...'`],
              error: 'AssertionError',
              kind: 'AssertionError',
            },
          ],
          fixes: [
            {
              thought: `The template referenced task.${field.replace(/_/g, '')} instead of task.${field}. Fixing the attribute name.`,
              file: T,
              change: '+1 −1',
              patch: `-        {% if task.${field.replace(/_/g, '')} %}…\n+        {% if task.${field} %}<span class="meta">${L}: {{ task.${field} }}</span>{% endif %}`,
            },
          ],
        },
      ],
      review: {
        score: 90,
        risk: 'low',
        verdict: 'approve',
        summary: `Straightforward, backwards-compatible addition. ${L} is optional and validated as free text; tests cover create, default and rendering.`,
        issues: [{ severity: 'minor', file: A, message: `Consider a maximum length for ${field} to keep rows tidy.` }],
      },
      verify: [
        { name: `Create task with ${field}`, method: 'POST', path: '/api/tasks', status: 201, ms: 87, detail: `${field} echoed back` },
        { name: `${L} rendered in the list`, method: 'GET', path: '/', status: 200, ms: 131, detail: `found "${L}:"` },
        { name: 'Health check', method: 'GET', path: '/healthz', status: 200, ms: 39, detail: '{"ok": true}' },
      ],
      preview: { field: { name: field, label: L } },
    }
  }
  const slug = (title.toLowerCase().match(/[a-z0-9]+/g) || ['change']).filter((w) => !['add', 'a', 'an', 'the', 'to', 'of', 'and', 'for', 'with'].includes(w)).slice(0, 3).join('-') || 'change'
  const flag = slug.replace(/-/g, '_')
  return {
    ...base,
    summary: `Implement the request (“${title}”) behind a feature flag, render it in the task list page and cover it with tests.`,
    steps: [
      'Locate the affected route handlers and template sections',
      `Add the "${slug}" feature behind FEATURES["${flag}"] in app.py`,
      'Render the new UI in templates/index.html when the flag is on',
      'Write tests for the flag and the rendered output',
    ],
    acceptance: [`The page reflects “${title}”`, 'The feature can be switched off with a single flag', 'All existing tests keep passing'],
    commit: `feat: ${title.charAt(0).toLowerCase()}${title.slice(1)}`.slice(0, 72),
    codeThought: `Adding a FEATURES flag for ${slug} and rendering the new section in the template.`,
    codeNote: 'Change ships behind a flag so it can be disabled without a redeploy of other features',
    edits: [
      [A, '_ids = itertools.count(1)\n', `_ids = itertools.count(1)\n\nFEATURES = {"${flag}": True}\n`],
      [A, '    return render_template("index.html", tasks=tasks)\n', '    return render_template("index.html", tasks=tasks, features=FEATURES)\n'],
      [T, '  <main class="container">\n', `  <main class="container">\n    {% if features.${flag} %}\n    <section class="whats-new" data-feature="${slug}">\n      <strong>New:</strong> ${title}\n    </section>\n    {% endif %}\n`],
      style('    .whats-new { padding: 10px 12px; margin-bottom: 16px; border-radius: 8px; background: #eef4ff; color: #1e3a8a; }\n'),
      tests(
        `def test_${flag}_flag_enabled():\n    assert acme.FEATURES["${flag}"] is True\n\n\n` +
          `def test_index_renders_${flag}(client):\n    html = client.get("/").get_data(as_text=True)\n    assert 'data-feature="${slug}"' in html\n`,
      ),
    ],
    heal: [
      {
        failing: [
          {
            name: `test_index_renders_${flag}`,
            at: 'data-feature',
            e: [`E       assert 'data-feature="${slug}"' in '<!doctype html>\\n<html lang="en">...'`],
            error: 'AssertionError',
            kind: 'AssertionError',
          },
        ],
        fixes: [
          {
            thought: 'index() never passed FEATURES to the template, so the section was skipped. Passing features=FEATURES.',
            file: A,
            change: '+1 −1',
            patch: '-    return render_template("index.html", tasks=tasks)\n+    return render_template("index.html", tasks=tasks, features=FEATURES)',
          },
        ],
      },
    ],
    review: {
      score: 88,
      risk: 'low',
      verdict: 'approve',
      summary: 'Scoped change behind a flag with tests for both the flag and the rendered output.',
      issues: [{ severity: 'info', file: A, message: 'Consider reading FEATURES from environment variables so flags can change without a deploy.' }],
    },
    verify: [
      { name: 'New section rendered', method: 'GET', path: '/', status: 200, ms: 129, detail: `found data-feature="${slug}"` },
      { name: 'Task API unaffected', method: 'GET', path: '/api/tasks', status: 200, ms: 57, detail: '3 tasks returned' },
      { name: 'Health check', method: 'GET', path: '/healthz', status: 200, ms: 38, detail: '{"ok": true}' },
    ],
    preview: { banner: { title } },
  }
}

export function pickScenario(prompt) {
  return SCENARIOS.find((s) => s.match && s.match.test(prompt)) || genericScenario(prompt)
}

// ---------------------------------------------------------------------------
// Materialisation: edits → files → diff, pytest output, tracebacks
// ---------------------------------------------------------------------------
export function applyEdits(edits) {
  const out = {}
  for (const [path, find, replace] of edits) {
    const current = out[path] ?? BASE_FILES[path] ?? ''
    if (find === null) out[path] = current + replace
    else if (current.includes(find)) out[path] = current.replace(find, () => replace)
    else throw new Error(`mock edit did not apply to ${path}: ${JSON.stringify(find.slice(0, 60))}`)
  }
  return out
}

const W = 80
function banner(text, ch = '=') {
  const t = ` ${text} `
  const left = Math.max(3, Math.floor((W - t.length) / 2))
  const right = Math.max(3, W - t.length - left)
  return ch.repeat(left) + t + ch.repeat(right)
}

function findLine(content, needle) {
  const idx = content.split('\n').findIndex((l) => l.includes(needle))
  return idx >= 0 ? idx + 1 : 1
}

function failureBlock(testFile, appFile, f) {
  const lines = testFile.split('\n')
  const start = lines.findIndex((l) => l.startsWith(`def ${f.name}(`))
  const out = [banner(f.name, '_'), '', "client = <FlaskClient <Flask 'app'>>", '']
  if (start < 0) return [...out, `E   ${f.error}`].join('\n')
  let end = start + 1
  while (end < lines.length && lines[end].startsWith('    ')) end++
  const body = lines.slice(start, end)
  let at = body.findIndex((l, i) => i > 0 && f.at && l.includes(f.at))
  if (at < 0) at = body.length - 1
  body.slice(0, at + 1).forEach((l, i) => out.push(`${i === at ? '>   ' : '    '}${l}`))
  const lineNo = start + at + 1
  if (f.trace) {
    out.push('', `tests/test_api.py:${lineNo}: `, '_ '.repeat(40).trimEnd())
    for (const t of f.trace) {
      out.push(t.replace(/\{(\w+)\}/g, (_, key) => String(findLine(appFile, f.lines?.[key] || key))))
    }
  } else {
    out.push(...(f.e || [`E       ${f.error}`]), '', `tests/test_api.py:${lineNo}: ${f.kind || 'AssertionError'}`)
  }
  return out.join('\n')
}

export function pytestOutput({ names, failing = [], seconds = 0.4, testFile, appFile }) {
  const total = names.length
  const failSet = new Set(failing.map((f) => f.name))
  const marks = names.map((n) => (failSet.has(n) ? 'F' : '.')).join('')
  const progress = `tests/test_api.py ${marks}`
  const head = [
    banner('test session starts'),
    'platform linux -- Python 3.12.7, pytest-8.3.3, pluggy-1.5.0',
    'rootdir: /workspace/acme-tasks',
    `collected ${total} items`,
    '',
    `${progress.padEnd(W - 7)} [100%]`,
    '',
  ]
  const secs = seconds.toFixed(2)
  if (!failing.length) return [...head, banner(`${total} passed in ${secs}s`)].join('\n')
  const out = [...head, banner('FAILURES')]
  for (const f of failing) out.push(failureBlock(testFile, appFile, f))
  out.push(banner('short test summary info'))
  for (const f of failing) out.push(`FAILED tests/test_api.py::${f.name} - ${f.error}`)
  out.push(banner(`${failing.length} failed, ${total - failing.length} passed in ${secs}s`))
  return out.join('\n')
}

/** Everything the simulator needs for one scenario, derived from its edits. */
export function materialize(sc) {
  const after = applyEdits(sc.edits)
  const order = [A, S, T, X].filter((p) => p in after).concat(Object.keys(after).filter((p) => ![A, S, T, X].includes(p)))
  const diff = order.map((p) => fileDiff(p, BASE_FILES[p] ?? null, after[p])).join('')
  const parsed = parseDiff(diff)
  const files = parsed.map((f) => ({ path: f.path, status: f.status, additions: f.additions, deletions: f.deletions }))
  const testFile = after[X] ?? TEST_PY
  const appFile = after[A] ?? APP_PY
  const newTests = [...testFile.matchAll(/^def (test_\w+)\(/gm)].map((m) => m[1]).filter((n) => !BASE_TEST_NAMES.includes(n))
  const names = [...BASE_TEST_NAMES, ...newTests]
  const firstHunk = Object.fromEntries(
    parsed.map((f) => {
      const h = f.hunks[0]
      const text = h ? [h.header, ...h.lines.slice(0, 16).map((l) => (l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' ') + l.text)].join('\n') : ''
      return [f.path, text]
    }),
  )
  const newTestCode = (() => {
    const lines = testFile.split('\n')
    const idx = lines.findIndex((l) => newTests.length && l.startsWith(`def ${newTests[0]}(`))
    return idx >= 0 ? lines.slice(idx).join('\n').trim() : ''
  })()
  return { ...sc, diff, files, names, newTests, testFile, appFile, firstHunk, newTestCode }
}
