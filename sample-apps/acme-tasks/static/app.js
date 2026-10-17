// Acme Tasks — progressive enhancement over the server-rendered list.
const list = document.getElementById("task-list");
const form = document.getElementById("new-task");
const errorBox = document.getElementById("form-error");
const summary = document.getElementById("summary");

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML;
}

function renderTask(task) {
  const li = document.createElement("li");
  li.className = "task" + (task.done ? " done" : "");
  li.dataset.id = task.id;
  li.innerHTML = `
    <label class="check">
      <input type="checkbox" ${task.done ? "checked" : ""} aria-label="Mark done">
      <span class="title">${escapeHtml(task.title)}</span>
    </label>
    ${task.assignee ? `<span class="assignee" title="${escapeHtml(task.assignee)}">${escapeHtml(task.assignee.slice(0, 1))}</span>` : ""}
    <button class="delete" aria-label="Delete task">×</button>`;
  return li;
}

async function refresh() {
  const res = await fetch("/api/tasks");
  const data = await res.json();
  list.replaceChildren(...data.tasks.map(renderTask));
  const done = data.tasks.filter((t) => t.done).length;
  summary.textContent = `${done} of ${data.tasks.length} done`;
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = !message;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const title = form.title.value;
  const assignee = form.assignee.value.trim() || null;
  const res = await fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, assignee }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    showError(data.error || "Could not add task");
    return;
  }
  showError("");
  form.reset();
  refresh();
});

list.addEventListener("change", async (event) => {
  if (event.target.type !== "checkbox") return;
  const id = event.target.closest(".task").dataset.id;
  await fetch(`/api/tasks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ done: event.target.checked }),
  });
  refresh();
});

list.addEventListener("click", async (event) => {
  if (!event.target.classList.contains("delete")) return;
  const id = event.target.closest(".task").dataset.id;
  await fetch(`/api/tasks/${id}`, { method: "DELETE" });
  refresh();
});
