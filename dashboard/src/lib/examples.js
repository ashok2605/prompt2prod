// Example prompts for the composer chips (the demo app is "Acme Tasks").
export const EXAMPLE_PROMPTS = [
  {
    label: 'Priority badges',
    prompt: 'Add a priority field (low/medium/high) to tasks with colored badges in the UI and API validation',
  },
  {
    label: 'Stats API + progress bar',
    prompt: 'Add GET /api/stats with total, done and completion % and show a progress bar on the page',
  },
  {
    label: 'Dark mode toggle',
    prompt: "Add a dark mode toggle that remembers the user's choice",
  },
  {
    label: 'Due dates & overdue',
    prompt: 'Add due dates and highlight overdue tasks in red',
  },
  {
    label: 'Fix: empty title → 400',
    prompt: 'Fix: creating a task with an empty title should return 400 with a helpful error',
  },
]
