// Offline demo only: renders the "Acme Tasks" target app as a standalone HTML
// document so the Live preview tab (and "Open preview/production") show a
// believable page that reflects the change, instead of a dead fake URL.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

function isoDay(offsetDays) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const SAMPLE = [
  { title: 'Draft Q3 roadmap', who: 'maya', priority: 'high', done: false, due: -2, extra: 'Planning' },
  { title: 'Fix login redirect loop', who: 'dev', priority: 'medium', done: true, due: -1, extra: 'Bug' },
  { title: 'Plan team offsite', who: 'sam', priority: 'low', done: false, due: 12, extra: 'Ops' },
  { title: 'Review onboarding checklist', who: 'maya', priority: 'medium', done: false, due: 3, extra: 'People' },
  { title: 'Update billing FAQ', who: 'priya', priority: 'low', done: true, due: null, extra: 'Docs' },
]

/** features: { priority, stats, darkmode, duedates, validation, search, assignees, shortcut, avatars, csv, field:{name,label}, banner:{title} } */
export function renderAcmePreview(features = {}) {
  const f = features || {}
  const done = SAMPLE.filter((t) => t.done).length
  const pct = Math.round((done / SAMPLE.length) * 1000) / 10
  const open = {}
  for (const t of SAMPLE) if (!t.done) open[t.who] = (open[t.who] || 0) + 1
  const loads = Object.entries(open).sort((a, b) => b[1] - a[1])

  const rows = SAMPLE.map((t, i) => {
    const overdue = f.duedates && t.due != null && t.due < 0 && !t.done
    const hue = (t.who.length * 47) % 360
    return `
      <li class="task${t.done ? ' done' : ''}${overdue ? ' overdue' : ''}" data-i="${i}">
        <input type="checkbox"${t.done ? ' checked' : ''} aria-label="Mark ${esc(t.title)} done">
        <span class="title">${esc(t.title)}</span>
        ${f.priority ? `<span class="badge badge-${t.priority}">${t.priority[0].toUpperCase() + t.priority.slice(1)}</span>` : ''}
        ${f.duedates && t.due != null ? `<span class="due">${overdue ? 'Overdue · ' : ''}due ${isoDay(t.due)}</span>` : ''}
        ${f.field ? `<span class="meta">${esc(f.field.label)}: ${esc(t.extra)}</span>` : ''}
        ${f.avatars
          ? `<span class="avatar" title="${t.who}" aria-label="Assigned to ${t.who}" style="background:hsl(${hue} 70% 42%)">${t.who[0].toUpperCase()}</span>`
          : `<span class="assignee">@${t.who}</span>`}
      </li>`
  }).join('')

  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Acme Tasks</title>
<style>
  * { box-sizing: border-box; }
  :root { --bg:#f7f7f8; --surface:#fff; --text:#1f2328; --muted:#6b7280; --border:#e5e7eb; --accent:#2563eb; }
  [data-theme="dark"] { --bg:#0f1115; --surface:#181b21; --text:#e6e8eb; --muted:#9ca3af; --border:#2a2f37; --accent:#60a5fa; color-scheme: dark; }
  body { margin:0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background:var(--bg); color:var(--text); transition: background .2s, color .2s; }
  .topbar { display:flex; align-items:center; gap:12px; flex-wrap:wrap; padding:16px 24px; background:var(--surface); border-bottom:1px solid var(--border); }
  .topbar h1 { font-size:20px; margin:0; }
  .muted { color:var(--muted); }
  .container { max-width:720px; margin:24px auto; padding:0 16px; }
  .new-task { display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap; }
  .new-task input, .new-task select { flex:1; min-width:120px; padding:8px 10px; border:1px solid #d1d5db; border-radius:6px; background:var(--surface); color:var(--text); font:inherit; }
  .new-task button { padding:8px 14px; border:0; border-radius:6px; background:var(--accent); color:#fff; font:inherit; cursor:pointer; }
  .task-list { list-style:none; padding:0; margin:0; }
  .task { display:flex; align-items:center; gap:10px; padding:10px 12px; background:var(--surface); border:1px solid var(--border); border-radius:8px; margin-bottom:8px; }
  .task.done .title { text-decoration:line-through; color:#9ca3af; }
  .assignee { margin-left:auto; color:var(--muted); font-size:14px; }
  .badge { font-size:12px; font-weight:600; padding:2px 8px; border-radius:999px; }
  .badge-low { background:#eef2f7; color:#475569; } .badge-medium { background:#fff4d6; color:#8a5a00; } .badge-high { background:#fde2e1; color:#b42318; }
  .stats { display:flex; align-items:center; gap:10px; margin-left:auto; }
  .progress { width:160px; height:8px; border-radius:999px; background:#e5e7eb; overflow:hidden; }
  .progress-fill { height:100%; background:#16a34a; transition: width .3s ease; }
  .due { font-size:13px; color:var(--muted); }
  .task.overdue { border-color:#f5b5b0; background:#fff5f4; }
  .task.overdue .title, .task.overdue .due { color:#b42318; font-weight:600; }
  [data-theme="dark"] .task.overdue { background:#2a1414; border-color:#5c2727; }
  [data-theme="dark"] .task.overdue .title, [data-theme="dark"] .task.overdue .due { color:#f47067; }
  .error { color:#b42318; font-size:14px; margin:-8px 0 12px; min-height:1em; }
  .search { width:100%; padding:8px 10px; margin-bottom:12px; border:1px solid #d1d5db; border-radius:6px; font:inherit; background:var(--surface); color:var(--text); }
  .load { display:flex; gap:6px; margin:0 0 0 auto; padding:0; list-style:none; }
  .pill { font-size:12px; padding:3px 10px; border-radius:999px; background:#eef2ff; color:#3730a3; }
  .avatar { margin-left:auto; display:inline-grid; place-items:center; width:26px; height:26px; border-radius:50%; color:#fff; font-size:12px; font-weight:700; }
  .theme-toggle { margin-left:auto; padding:6px 12px; border:1px solid var(--border); border-radius:999px; background:var(--surface); color:var(--text); cursor:pointer; font:inherit; }
  .export { margin-left:auto; color:var(--accent); font-size:14px; text-decoration:none; }
  .meta { font-size:13px; color:var(--muted); }
  .whats-new { padding:10px 12px; margin-bottom:16px; border-radius:8px; background:#eef4ff; color:#1e3a8a; }
  .kbd { font: 12px ui-monospace, monospace; padding: 1px 6px; border: 1px solid var(--border); border-radius: 4px; color: var(--muted); }
</style>
</head>
<body>
  <header class="topbar">
    <h1>Acme Tasks</h1>
    <span class="muted" id="count">${SAMPLE.length} tasks</span>
    ${f.stats ? `<div class="stats"><div class="progress" role="progressbar" aria-label="Completion" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><div class="progress-fill" id="fill" style="width:${pct}%"></div></div><span class="muted" id="pct">${done}/${SAMPLE.length} done · ${pct}%</span></div>` : ''}
    ${f.assignees ? `<ul class="load" aria-label="Open tasks per person">${loads.map(([w, c]) => `<li class="pill">${w} <strong>${c}</strong></li>`).join('')}</ul>` : ''}
    ${f.csv ? '<a class="export" href="#" onclick="return false">Export CSV</a>' : ''}
    ${f.darkmode ? '<button id="theme-toggle" class="theme-toggle" type="button" aria-label="Toggle dark mode" aria-pressed="false">Dark mode</button>' : ''}
  </header>
  <main class="container">
    ${f.banner ? `<section class="whats-new"><strong>New:</strong> ${esc(f.banner.title)}</section>` : ''}
    <form id="new-task" class="new-task">
      <input name="title" placeholder="What needs doing?${f.shortcut ? ' (press N)' : ''}" autocomplete="off" required>
      <input name="assignee" placeholder="Assignee">
      ${f.priority ? '<select name="priority" aria-label="Priority"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option></select>' : ''}
      ${f.duedates ? '<input name="due_date" type="date" aria-label="Due date">' : ''}
      ${f.field ? `<input name="${esc(f.field.name)}" placeholder="${esc(f.field.label)}">` : ''}
      <button type="submit">Add task</button>
    </form>
    ${f.validation ? '<p id="form-error" class="error" role="alert"></p>' : ''}
    ${f.search ? '<input id="search" class="search" type="search" placeholder="Search tasks…" aria-label="Search tasks" autocomplete="off">' : ''}
    <ul class="task-list" id="list">${rows}
    </ul>
    ${f.shortcut ? '<p class="muted" style="font-size:13px">Tip: press <span class="kbd">N</span> anywhere to add a task.</p>' : ''}
  </main>
  <script>
    (function () {
      var list = document.getElementById('list');
      function refresh() {
        var items = list.querySelectorAll('.task');
        var done = list.querySelectorAll('.task.done').length;
        document.getElementById('count').textContent = items.length + ' tasks';
        var fill = document.getElementById('fill');
        if (fill) {
          var pct = items.length ? Math.round(done / items.length * 1000) / 10 : 0;
          fill.style.width = pct + '%';
          document.getElementById('pct').textContent = done + '/' + items.length + ' done · ' + pct + '%';
        }
      }
      list.addEventListener('change', function (e) {
        if (e.target.type === 'checkbox') { e.target.closest('.task').classList.toggle('done', e.target.checked); refresh(); }
      });
      document.getElementById('new-task').addEventListener('submit', function (e) {
        e.preventDefault();
        var form = e.target, title = form.title.value, err = document.getElementById('form-error');
        if (!title.trim()) { if (err) err.textContent = 'title is required (1-200 characters)'; return; }
        if (err) err.textContent = '';
        var li = document.createElement('li');
        li.className = 'task';
        li.innerHTML = '<input type="checkbox"><span class="title"></span><span class="assignee"></span>';
        li.querySelector('.title').textContent = title.trim();
        li.querySelector('.assignee').textContent = '@' + (form.assignee.value.trim() || 'unassigned');
        list.appendChild(li);
        form.reset();
        refresh();
      });
      var search = document.getElementById('search');
      if (search) search.addEventListener('input', function () {
        var q = search.value.trim().toLowerCase();
        list.querySelectorAll('.task').forEach(function (row) {
          row.hidden = row.querySelector('.title').textContent.toLowerCase().indexOf(q) === -1;
        });
      });
      var toggle = document.getElementById('theme-toggle');
      if (toggle) {
        var root = document.documentElement;
        var saved = null;
        try { saved = localStorage.getItem('theme'); } catch (e) {}
        if (saved) root.dataset.theme = saved;
        var sync = function () {
          var dark = root.dataset.theme === 'dark';
          toggle.setAttribute('aria-pressed', String(dark));
          toggle.textContent = dark ? 'Light mode' : 'Dark mode';
        };
        toggle.addEventListener('click', function () {
          root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
          try { localStorage.setItem('theme', root.dataset.theme); } catch (e) {}
          sync();
        });
        sync();
      }
      ${f.shortcut ? `document.addEventListener('keydown', function (e) {
        if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.key === 'n' || e.key === 'N') { e.preventDefault(); document.querySelector('#new-task input[name="title"]').focus(); }
      });` : ''}
    })();
  </script>
</body>
</html>`
}
