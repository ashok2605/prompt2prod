"""The Prompt2Prod crew: Google ADK agents running on Gemini (Vertex AI).

Planner, Test Author, Coder, Reviewer and Verifier are `LlmAgent`s. The Test Author
and Coder act on the task's git workspace through sandboxed function tools; every
tool call is streamed to the live dashboard log.
"""
import asyncio
import difflib
import re
from typing import Literal

from google.adk.agents import LlmAgent, RunConfig
from google.adk.planners import BuiltInPlanner
from google.adk.runners import InMemoryRunner
from google.genai import types
from pydantic import BaseModel, Field

from . import config, sandbox
from .gitrepo import line_delta

APP_NAME = "prompt2prod"


# ---------------------------------------------------------------- structured outputs

class PlanOut(BaseModel):
    feasible: bool = Field(description="false if the request is unsafe, malicious, out of scope or impossible")
    reason: str = Field(default="", description="why it is not feasible (empty when feasible)")
    title: str = Field(description="imperative title, max 60 chars, e.g. 'Add task priority badges'")
    summary: str = Field(description="1-2 sentence description of the change")
    steps: list[str] = Field(description="3-7 concrete implementation steps referencing real files/functions")
    files: list[str] = Field(description="repository paths that will be created or modified")
    acceptance_criteria: list[str] = Field(description="2-6 objectively testable criteria")
    test_strategy: str
    risk: Literal["low", "medium", "high"]
    estimated_manual_hours: float = Field(description="hours a mid-level engineer would need incl. tests, review, deploy")
    commit_message: str = Field(description="Conventional Commits subject line, max 72 chars")


class ReviewIssue(BaseModel):
    severity: Literal["info", "minor", "major", "critical"]
    file: str
    message: str


class ReviewOut(BaseModel):
    score: int = Field(description="0-100 overall quality; 90+ means ready to ship")
    risk: Literal["low", "medium", "high"]
    verdict: Literal["approve", "request_changes"]
    summary: str
    issues: list[ReviewIssue]


class SmokeCheck(BaseModel):
    name: str
    method: Literal["GET", "POST", "PATCH", "PUT", "DELETE"]
    path: str = Field(description="path starting with /, e.g. /api/tasks")
    json_body: str = Field(default="", description="JSON request body as a string, empty for none")
    expect_status: int
    expect_contains: list[str] = Field(default_factory=list, description="short exact substrings expected in the body")


class VerifyOut(BaseModel):
    checks: list[SmokeCheck]


class VisualOut(BaseModel):
    applicable: bool = Field(description="false when the change has no visible effect on this page (e.g. API-only)")
    passed: bool = Field(description="true if the screenshot visibly satisfies the UI-related acceptance criteria")
    summary: str = Field(description="one sentence verdict")
    observations: list[str] = Field(description="2-5 concrete things you can see (or cannot see) in the screenshot")


# ---------------------------------------------------------------- instructions

PLANNER_INSTRUCTION = """You are the Planner of Prompt2Prod, an autonomous software crew that ships changes to production.
Turn the developer's change request into a precise, minimal implementation plan for the repository you are given.
- Read AGENTS.md conventions and the source carefully; reference real files, routes and functions.
- Keep scope tight: implement exactly what was asked, nothing more.
- Acceptance criteria must be objectively testable (HTTP status codes, JSON fields, visible page text or elements).
- If the request is unsafe, malicious, unrelated to changing this codebase, or impossible, set feasible=false and explain why.
- estimated_manual_hours: realistic effort for a mid-level engineer including tests, review and deployment.
- commit_message: Conventional Commits style (feat:, fix:, ...), imperative mood."""

TEST_AUTHOR_INSTRUCTION = """You are the Test Author of Prompt2Prod and you practice test-driven development.
BEFORE any application code changes, write pytest tests that verify the plan's acceptance criteria.
- Only create or modify files under tests/. Never edit application code.
- Follow the existing style: use the `client` fixture from tests/conftest.py (Flask test client).
- Add focused tests (usually 2-5) with descriptive names. Do not duplicate existing tests. Update an existing test only if the requested change makes it obsolete.
- For UI behaviour, assert on stable visible text or element ids/classes in the rendered HTML.
- Inspect the code first (read_file). Use replace_in_file for small edits or write_file with complete content.
- The new tests are expected to fail right now because the feature is not implemented yet.
- Finish with a two-sentence summary of the tests you wrote."""

CODER_INSTRUCTION = """You are the Coder of Prompt2Prod. Implement the plan so that the FULL test suite passes, including the new tests written by the Test Author.
- Read the relevant files before editing. Make minimal, clean, idiomatic changes that follow AGENTS.md.
- Prefer replace_in_file for small edits; use write_file with the COMPLETE content for new files or large rewrites.
- Never delete or weaken tests to make them pass. Only fix a test if it is clearly wrong, and say why.
- Keep the UI consistent with the existing design. Do not add dependencies unless unavoidable.
- Call run_tests to check your work and keep iterating until everything passes.
- Finish with a short summary of what you changed."""

REVIEWER_INSTRUCTION = """You are the Reviewer of Prompt2Prod: a meticulous senior engineer reviewing an AI-generated change before it ships to production.
Evaluate correctness against the request and acceptance criteria, test quality and coverage, security (input validation, XSS/HTML escaping, injection, secrets), error handling, maintainability and consistency with AGENTS.md.
- score: 0-100 (90+ = ready to ship).
- risk: blast radius if this ships with a defect (low / medium / high).
- verdict: request_changes ONLY for real defects (bugs, security problems, missing/incorrect behaviour) — not for style nits.
- issues: concrete, actionable, each with severity and file. Empty list if none."""

VERIFIER_INSTRUCTION = """You are the Verifier of Prompt2Prod. The change is now live on a preview URL served by a dedicated Cloud Run revision.
Design 3-6 HTTP smoke checks that prove the requested behaviour works in the deployed app and that core functionality did not regress.
- Each check: name, method, path, optional json_body (a JSON string), expect_status, expect_contains (short, exact, robust substrings such as a JSON key or a visible label).
- Use the actual routes and response shapes from the diff and code. Prefer read-only checks; POST is fine for creation/validation behaviour.
- Keep expect_contains minimal: a JSON key like "priority" or a single value like "high" — never a multi-field JSON fragment (Flask returns compact JSON).
- The app has seed data and in-memory state; do not depend on ids created by other checks.
- Checks are plain HTTP requests: no browser, no JavaScript execution. Verify UI changes by GETting the page ("/") or a
  static asset (e.g. "/static/app.js", "/static/style.css") and checking for the expected markup, ids, classes or text.
- path must be a real route starting with "/" — never a URL, fragment or "javascript:" pseudo-link.
- When creating data, prefix titles with "[smoke]" so it is recognisable."""


VISUAL_INSTRUCTION = """You are the visual QA reviewer of Prompt2Prod. You get a screenshot of the live preview of a web app
right after an AI-generated change was deployed, plus the change request and its acceptance criteria.
Judge ONLY what is visible: is the requested UI change present and does the page look intact (no broken layout, no raw
template code, no error page)? If the change has no visible effect on this page (API-only), set applicable=false and passed=true."""


# ---------------------------------------------------------------- usage meter

class Usage:
    def __init__(self):
        self.calls = 0
        self.tokens_in = 0
        self.tokens_out = 0
        self.cost = 0.0
        self.models = {}

    def add(self, model, meta):
        if not meta:
            return
        tin = meta.prompt_token_count or 0
        tout = (meta.candidates_token_count or 0) + (getattr(meta, "thoughts_token_count", 0) or 0)
        if not tin and not tout:
            return
        self.calls += 1
        self.tokens_in += tin
        self.tokens_out += tout
        price_in, price_out = config.MODEL_PRICES.get(model, (0.5, 3.0))
        self.cost += tin / 1e6 * price_in + tout / 1e6 * price_out

    def as_dict(self):
        return {
            "llmCalls": self.calls,
            "tokensIn": self.tokens_in,
            "tokensOut": self.tokens_out,
            "costUsd": round(self.cost, 4),
        }


# ---------------------------------------------------------------- tools

def edit_preview(path, before, after, max_lines=80):
    """Compact unified diff of one edit, shown when a log event is expanded."""
    lines = list(difflib.unified_diff(before.splitlines(), after.splitlines(), f"a/{path}", f"b/{path}",
                                      lineterm="", n=2))
    if len(lines) > max_lines:
        lines = lines[:max_lines] + [f"… {len(lines) - max_lines} more lines"]
    return "\n".join(lines) or None


class Toolkit:
    """Workspace tools handed to ADK agents. Each call is mirrored into the live log."""

    def __init__(self, ws, emit, stage, agent, tests_only=False, on_test_run=None):
        self.ws = ws
        self.emit = emit
        self.stage = stage
        self.agent = agent
        self.tests_only = tests_only
        self.on_test_run = on_test_run
        self.files_written = set()

    def _log(self, message, detail=None, kind="tool"):
        self.emit(self.stage, self.agent, kind, message, detail)

    def _guard(self, path):
        rel, _ = self.ws.resolve(path)
        if self.tests_only and not rel.startswith("tests/"):
            raise PermissionError("the Test Author may only modify files under tests/")
        return rel

    def tools(self, with_run_tests=False):
        kit = self

        def list_files() -> dict:
            """List every file in the repository (paths relative to the repo root)."""
            files = kit.ws.list_files()
            kit._log(f"list_files → {len(files)} files")
            return {"files": files}

        def read_file(path: str) -> dict:
            """Read a UTF-8 text file from the repository.

            Args:
                path: Repository-relative path, e.g. "app.py" or "templates/index.html".
            """
            try:
                content = kit.ws.read(path)
            except (FileNotFoundError, IsADirectoryError):
                kit._log(f"read_file {path} → not found", kind="warn")
                return {"error": f"{path} does not exist"}
            except ValueError as exc:
                return {"error": str(exc)}
            kit._log(f"read_file {path} ({content.count(chr(10)) + 1} lines)")
            return {"path": path, "content": content}

        def write_file(path: str, content: str) -> dict:
            """Create a file or overwrite it completely. Always pass the FULL new file content.

            Args:
                path: Repository-relative path of the file to write.
                content: The complete new content of the file.
            """
            try:
                rel = kit._guard(path)
                before = kit.ws.read_or_empty(rel)
                kit.ws.write(rel, content)
            except (PermissionError, ValueError) as exc:
                kit._log(f"write_file {path} blocked: {exc}", kind="warn")
                return {"error": str(exc)}
            adds, dels = line_delta(before, content)
            kit.files_written.add(rel)
            kit._log(f"{'write_file' if before else 'create_file'} {rel} (+{adds} −{dels})",
                     detail=edit_preview(rel, before, content))
            return {"ok": True, "path": rel}

        def replace_in_file(path: str, old_text: str, new_text: str) -> dict:
            """Replace exactly one occurrence of old_text with new_text in a file.

            Fails if old_text does not occur exactly once; then re-read the file and retry with a
            larger unique snippet, or use write_file.

            Args:
                path: Repository-relative path of the file to edit.
                old_text: Exact existing text to replace (must be unique in the file).
                new_text: Replacement text.
            """
            try:
                rel = kit._guard(path)
                before = kit.ws.read(rel)
            except FileNotFoundError:
                return {"error": f"{path} does not exist"}
            except (PermissionError, ValueError) as exc:
                kit._log(f"replace_in_file {path} blocked: {exc}", kind="warn")
                return {"error": str(exc)}
            hits = before.count(old_text)
            if hits != 1:
                kit._log(f"replace_in_file {rel} → old_text matched {hits}×, retrying", kind="warn")
                return {"error": f"old_text occurs {hits} times in {rel}; it must occur exactly once"}
            after = before.replace(old_text, new_text, 1)
            kit.ws.write(rel, after)
            adds, dels = line_delta(before, after)
            kit.files_written.add(rel)
            kit._log(f"edit {rel} (+{adds} −{dels})", detail=edit_preview(rel, before, after))
            return {"ok": True, "path": rel}

        def delete_file(path: str) -> dict:
            """Delete a file from the repository.

            Args:
                path: Repository-relative path of the file to delete.
            """
            try:
                rel = kit._guard(path)
                kit.ws.delete(rel)
            except (FileNotFoundError, PermissionError, ValueError) as exc:
                return {"error": str(exc)}
            kit._log(f"delete_file {rel}")
            return {"ok": True}

        def search_code(query: str) -> dict:
            """Case-insensitive plain-text search across the repository.

            Args:
                query: Text to look for.
            """
            needle = query.lower()
            hits = []
            for rel in kit.ws.list_files():
                try:
                    lines = kit.ws.read(rel).splitlines()
                except Exception:
                    continue
                for no, line in enumerate(lines, 1):
                    if needle in line.lower():
                        hits.append(f"{rel}:{no}: {line.strip()[:200]}")
                        if len(hits) >= 60:
                            break
            kit._log(f'search_code "{query[:40]}" → {len(hits)} matches')
            return {"matches": hits}

        def run_tests() -> dict:
            """Run the full pytest suite. Returns pass/fail counts and the failure output."""
            result = sandbox.run_tests(kit.ws.repo)
            kit._log(
                f"run_tests → {sandbox.summarize(result)}",
                detail=None if result["ok"] else result["output"][-3000:],
                kind="success" if result["ok"] else "tool",
            )
            if kit.on_test_run:
                kit.on_test_run(result, kit.agent, len(kit.files_written))
            return {
                "ok": result["ok"], "passed": result["passed"], "failed": result["failed"],
                "total": result["total"], "failing": result["failing"],
                "output": result["output"][-4000:],
            }

        tools = [list_files, read_file, write_file, replace_in_file, search_code]
        if not self.tests_only:
            tools.append(delete_file)
        if with_run_tests:
            tools.append(run_tests)
        return tools


# ---------------------------------------------------------------- runner

def _retryable(exc):
    text = str(exc)
    return any(code in text for code in ("404", "429", "500", "503", "RESOURCE_EXHAUSTED", "UNAVAILABLE", "NOT_FOUND"))


def _thought_title(text):
    match = re.search(r"\*\*(.+?)\*\*", text or "")
    title = match.group(1) if match else (text or "").strip().split("\n")[0]
    return title[:160]


async def run_agent(*, role, name, instruction, prompt, emit, stage, label, usage,
                    tools=None, output_schema=None, max_llm_calls=40, thinking=True):
    """Run one ADK LlmAgent to completion; returns (final_text, structured_output, model_used)."""
    primary = config.MODELS[role]
    candidates = [primary] + [m for m in config.FALLBACK_MODELS if m != primary]
    last_exc = None
    budget = config.AGENT_TIMEOUTS.get(role, 120)
    for i, model in enumerate(candidates):
        last = i == len(candidates) - 1
        try:
            run = _run_once(model, name, instruction, prompt, emit, stage, label, usage, tools, output_schema,
                            max_llm_calls, config.THINKING.get(role, "LOW") if thinking else None)
            text, output = await (run if last else asyncio.wait_for(run, timeout=budget))
            return text, output, model
        except asyncio.TimeoutError as exc:
            last_exc = exc
            emit(stage, label, "warn", f"{model} exceeded its {budget}s latency budget; switching to {candidates[i + 1]}")
        except Exception as exc:
            if not _retryable(exc):
                raise
            last_exc = exc
            emit(stage, label, "warn", f"{model} unavailable ({str(exc)[:80]}); falling back")
    raise last_exc


async def _run_once(model, name, instruction, prompt, emit, stage, label, usage,
                    tools, output_schema, max_llm_calls, thinking):
    kwargs = {}
    if output_schema is not None:
        kwargs.update(output_schema=output_schema, output_key="result")
    if thinking:
        if model.startswith("gemini-2"):
            thinking_config = types.ThinkingConfig(include_thoughts=True, thinking_budget=2048)
        else:
            thinking_config = types.ThinkingConfig(include_thoughts=True, thinking_level=thinking)
        kwargs["planner"] = BuiltInPlanner(thinking_config=thinking_config)
    agent = LlmAgent(
        name=name,
        model=model,
        instruction=instruction,
        tools=tools or [],
        generate_content_config=types.GenerateContentConfig(temperature=0.2),
        **kwargs,
    )
    runner = InMemoryRunner(agent=agent, app_name=APP_NAME)
    session = await runner.session_service.create_session(app_name=APP_NAME, user_id="crew")
    texts = []
    message = types.Content(role="user", parts=[types.Part(text=prompt)])
    async for event in runner.run_async(user_id="crew", session_id=session.id, new_message=message,
                                        run_config=RunConfig(max_llm_calls=max_llm_calls)):
        usage.add(model, getattr(event, "usage_metadata", None))
        if not event.content or not event.content.parts:
            continue
        for part in event.content.parts:
            if getattr(part, "thought", False) and part.text:
                emit(stage, label, "thought", _thought_title(part.text), part.text)
            elif part.text and not part.function_call:
                texts.append(part.text)
    output = None
    if output_schema is not None:
        state = (await runner.session_service.get_session(
            app_name=APP_NAME, user_id="crew", session_id=session.id)).state
        output = state.get("result")
        if isinstance(output, BaseModel):
            output = output.model_dump()
        if output is None and texts:
            output = output_schema.model_validate_json(_extract_json(texts[-1])).model_dump()
    return "\n".join(t for t in texts if t.strip()), output


def _extract_json(text):
    match = re.search(r"\{.*\}", text, re.S)
    return match.group(0) if match else text
