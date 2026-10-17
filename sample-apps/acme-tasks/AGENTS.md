# AGENTS.md — conventions for the Prompt2Prod AI crew

Acme Tasks is a small Flask app (Python 3.12) deployed on Cloud Run.

## Layout
- `app.py` — `create_app()` factory, `TaskStore` (in-memory), all routes. JSON API under `/api/*`.
- `templates/index.html` — the single server-rendered page (Jinja2).
- `static/style.css`, `static/app.js` — UI styles and progressive-enhancement JS (vanilla, no build step).
- `tests/` — pytest suite. `conftest.py` provides a `client` fixture (Flask test client on a fresh app).

## Rules
- Keep the `create_app()` factory; never add global state outside `TaskStore`.
- API errors are JSON: `{"error": "<message>"}` with a proper 4xx status.
- Every behaviour change needs tests in `tests/` (API tests in `test_api.py`, page tests in `test_ui.py`).
- No new third-party dependencies unless strictly necessary (add them to `requirements.txt`).
- UI changes must work without a build step and keep the existing look (Inter font, CSS variables in `:root`).
- Run tests with: `python -m pytest -q`
