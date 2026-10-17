"""One developer request → planned, test-first, implemented, reviewed, built, previewed, verified, released."""
import asyncio
import html
import json
import re
import time
import traceback

import httpx
from urllib.parse import urlparse

from . import agents, cloud, config, gitrepo, release, sandbox, store
from .agents import PlanOut, ReviewOut, Toolkit, Usage, VerifyOut, run_agent

STEP_MESSAGES = {
    "restore-cache:WORKING": "Restoring Docker layer cache from Artifact Registry",
    "docker-build:WORKING": "docker build (reusing cached dependency layers)",
    "docker-build:SUCCESS": "Container image built",
    "docker-build:FAILURE": "docker build failed",
}


def body_contains(res, needle):
    """Substring match that tolerates JSON spacing and HTML escaping differences."""
    text = res.text
    if needle in text or needle in html.unescape(text):
        return True
    try:
        data = res.json()
        for seps in ((", ", ": "), (",", ":")):
            if needle in json.dumps(data, separators=seps, ensure_ascii=False):
                return True
    except ValueError:
        pass
    squash = lambda value: re.sub(r"\s+", "", value)  # noqa: E731
    return squash(needle) in squash(html.unescape(text))


class Stop(Exception):
    """Graceful early stop, e.g. when the Planner declines an out-of-scope request."""

    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


class Pipeline:
    def __init__(self, task, runner_id="inline"):
        self.task = task
        self.id = task["id"]
        self.project = store.get_project(task["projectId"])
        self.log = store.EventLog.resume(self.id)
        self.usage = Usage()
        self.ws = gitrepo.Workspace(self.project["id"], self.id)
        self.runner_id = runner_id
        self.stage_started = {}
        self.attempts = []
        self.models = {}
        self.current = "sandbox"
        self.started = time.time()
        self.base_test_count = 0
        self.requester = (task.get("requestedBy") or {}).get("name") or "a developer"

    # ------------------------------------------------------------ helpers
    def emit(self, stage, agent, kind, message, detail=None):
        self.log.emit(stage, agent, kind, message, detail)

    def stage(self, key, status, summary=None):
        now = store.utcnow()
        if status == "running":
            self.stage_started[key] = now
            self.current = key
        entry = {"status": status, "startedAt": self.stage_started.get(key, now)}
        if status != "running":
            entry["endedAt"] = now
        if summary:
            entry["summary"] = summary
        data = {f"stages.{key}": entry}
        if status == "running":
            data["stage"] = key
        store.update_task(self.id, data)

    def record_attempt(self, result, by, phase, edits=0):
        self.attempts.append({
            "n": len(self.attempts) + 1,
            "phase": phase,
            "by": by,
            "afterEdits": edits,
            "ok": result["ok"],
            "passed": result["passed"],
            "failed": result["failed"],
            "total": result["total"],
            "summary": sandbox.summarize(result),
            "durationSec": result["durationSec"],
        })
        store.update_task(self.id, {
            "tests.attempts": self.attempts,
            "tests.passed": result["passed"],
            "tests.failed": result["failed"],
            "tests.total": result["total"],
            "tests.output": result["output"][-6000:],
        })

    def count_tests(self):
        total = 0
        for rel in self.ws.list_files():
            if rel.startswith("tests/") and rel.endswith(".py"):
                total += len(re.findall(r"^\s*(?:async\s+)?def test_", self.ws.read_or_empty(rel), re.M))
        return total

    def plan_brief(self, plan):
        return json.dumps({k: plan[k] for k in ("title", "summary", "steps", "files", "acceptance_criteria",
                                                "test_strategy")}, indent=2)

    def finish(self, status, error=None):
        now = store.utcnow()
        data = {"status": status, "finishedAt": now}
        if status == "deployed":
            data["stage"] = "done"
        if error:
            data["error"] = error[:600]
        if status in ("failed", "rejected"):
            snap = store.get_task(self.id) or {}
            stages = snap.get("stages") or {}
            for key in config.STAGES:
                if key not in stages or stages[key].get("status") in (None, "pending"):
                    data[f"stages.{key}"] = {"status": "skipped"}
        store.update_task(self.id, data)

    # ------------------------------------------------------------ main flow
    async def run(self):
        status = "failed"
        try:
            await self.sandbox()
            plan = await self.plan()
            await self.tests_first(plan)
            await self.implement(plan)
            await self.test_and_heal(plan)
            review = await self.review(plan)
            self.commit(plan)
            image = await self.build()
            preview_url = await self.preview(image)
            verify = await self.verify(plan, preview_url)
            status = await self.release(review, verify, preview_url)
        except Stop as stop:
            status = stop.status
            self.emit(self.current, "Orchestrator", "warn", stop.message)
            self.stage(self.current, "failed", summary="declined")
            self.finish(stop.status, error=stop.message)
        except Exception as exc:  # noqa: BLE001 — surface every failure to the dashboard
            self.emit(self.current, "Orchestrator", "error", f"Pipeline stopped: {exc}", traceback.format_exc()[-4000:])
            self.stage(self.current, "failed", summary=str(exc)[:140])
            self.finish("failed", error=str(exc))
        finally:
            metrics = self.usage.as_dict()
            update = {f"metrics.{k}": v for k, v in metrics.items()}
            update["metrics.durationSec"] = round(time.time() - self.started)
            update["metrics.models"] = self.models
            try:
                store.update_task(self.id, update)
            except Exception as exc:  # noqa: BLE001
                print("metrics update failed", exc)
            self.ws.cleanup()
        return status

    # ------------------------------------------------------------ stages
    async def sandbox(self):
        self.stage("sandbox", "running")
        local = self.runner_id.startswith(("local", "inline"))
        where = "in-process sandbox" if local else f"Cloud Run Job execution {self.runner_id}"
        self.emit("sandbox", "Orchestrator", "info", f"Isolated sandbox online · {where}")
        base = await asyncio.to_thread(self.ws.restore)
        files = self.ws.list_files()
        self.base_test_count = self.count_tests()
        self.emit("sandbox", "Orchestrator", "success",
                  f"Checked out {self.project['name']} main@{base[:7]} → {self.ws.branch} ({len(files)} files, "
                  f"{self.base_test_count} existing tests)")
        store.update_task(self.id, {"commit": {"baseSha": base, "branch": self.ws.branch}})
        self.stage("sandbox", "done", f"main@{base[:7]} · {len(files)} files")

    async def plan(self):
        self.stage("plan", "running")
        self.emit("plan", "Planner", "info", f"Reading the codebase and the request with {config.MODELS['planner']}")
        prompt = (
            f"Developer request (from {self.requester}):\n\"\"\"\n{self.task['prompt']}\n\"\"\"\n\n"
            f"Repository: {self.project['name']} ({self.project.get('stack', '')})\n\n{self.ws.snapshot()}"
        )
        _, plan, model = await run_agent(
            role="planner", name="planner", instruction=agents.PLANNER_INSTRUCTION, prompt=prompt,
            emit=self.emit, stage="plan", label="Planner", usage=self.usage, output_schema=PlanOut,
        )
        self.models["planner"] = model
        if not plan:
            raise RuntimeError("Planner returned no plan")
        if not plan.get("feasible", True):
            store.update_task(self.id, {"title": (plan.get("title") or "Request declined")[:80],
                                        "plan": {"summary": plan.get("reason", ""), "steps": [], "files": [],
                                                 "acceptance": [], "risk": plan.get("risk", "low")}})
            raise Stop("rejected", f"Planner declined the request: {plan.get('reason') or 'out of scope'}")
        hours = round(max(0.25, min(float(plan.get("estimated_manual_hours") or 1), 40)), 1)
        store.update_task(self.id, {
            "title": plan["title"][:80],
            "plan": {
                "summary": plan["summary"],
                "steps": plan["steps"],
                "files": plan["files"],
                "acceptance": plan["acceptance_criteria"],
                "risk": plan["risk"],
                "estimatedHours": hours,
                "testStrategy": plan.get("test_strategy", ""),
                "commitMessage": plan.get("commit_message", ""),
            },
        })
        for i, step in enumerate(plan["steps"], 1):
            self.emit("plan", "Planner", "info", f"Step {i}: {step}")
        self.emit("plan", "Planner", "success",
                  f"Plan ready: {len(plan['steps'])} steps · {len(plan['files'])} files · {plan['risk']} risk · "
                  f"saves ~{hours}h of manual work")
        self.stage("plan", "done", f"{len(plan['steps'])} steps · {plan['risk']} risk")
        return plan

    async def tests_first(self, plan):
        self.stage("tests", "running")
        kit = Toolkit(self.ws, self.emit, "tests", "Test Author", tests_only=True)
        files = self.ws.list_files()
        relevant = sorted({f for f in files if f.startswith("tests/")} | {"AGENTS.md"} |
                          {f for f in plan["files"] if f in files and not f.startswith("tests/")})
        prompt = (
            f"Developer request:\n\"\"\"\n{self.task['prompt']}\n\"\"\"\n\nPlan:\n{self.plan_brief(plan)}\n\n"
            f"All repository files: {files}\n\nRelevant files:\n{self.ws.snapshot(relevant)}\n\n"
            "Write the tests for the acceptance criteria now."
        )
        text, _, model = await run_agent(
            role="test_author", name="test_author", instruction=agents.TEST_AUTHOR_INSTRUCTION, prompt=prompt,
            emit=self.emit, stage="tests", label="Test Author", usage=self.usage, tools=kit.tools(),
            max_llm_calls=30,
        )
        self.models["testAuthor"] = model
        new_tests = max(self.count_tests() - self.base_test_count, 0)
        store.update_task(self.id, {"tests.newTests": new_tests})
        if text:
            self.emit("tests", "Test Author", "info", text.strip()[:500])
        result = await asyncio.to_thread(sandbox.run_tests, self.ws.repo)
        self.record_attempt(result, "Test Author", "tdd")
        if result["ok"]:
            self.emit("tests", "Test Runner", "info", f"Test-first run: {sandbox.summarize(result)}")
        else:
            self.emit("tests", "Test Runner", "info",
                      f"TDD red phase ✓ {result['failed']} test(s) fail before implementation, as expected",
                      result["output"][-2500:])
        self.stage("tests", "done", f"{new_tests} new tests · red {result['failed']}")

    async def implement(self, plan):
        self.stage("code", "running")
        kit = Toolkit(self.ws, self.emit, "code", "Coder",
                      on_test_run=lambda r, by, edits: self.record_attempt(r, by, "coder", edits))
        files = self.ws.list_files()
        focus = sorted({f for f in plan["files"] if f in files} | {f for f in files if f.startswith("tests/")} |
                       {"AGENTS.md"})
        last = self.attempts[-1] if self.attempts else None
        prompt = (
            f"Developer request:\n\"\"\"\n{self.task['prompt']}\n\"\"\"\n\nPlan:\n{self.plan_brief(plan)}\n\n"
            f"Latest test run (after the Test Author's new tests): {last['summary'] if last else 'n/a'}\n\n"
            f"All repository files: {files}\n\nCurrent content of the key files:\n{self.ws.snapshot(focus)}\n\n"
            "Implement the change now, then call run_tests and iterate until the whole suite passes."
        )
        text, _, model = await run_agent(
            role="coder", name="coder", instruction=agents.CODER_INSTRUCTION, prompt=prompt,
            emit=self.emit, stage="code", label="Coder", usage=self.usage, tools=kit.tools(with_run_tests=True),
            max_llm_calls=50,
        )
        self.models["coder"] = model
        _, stats = self.ws.changes()
        adds = sum(s["additions"] for s in stats)
        dels = sum(s["deletions"] for s in stats)
        store.update_task(self.id, {"files": stats})
        self.emit("code", "Coder", "success", f"Implementation complete: {len(stats)} files changed (+{adds} −{dels})",
                  text[:2000] if text else None)
        self.stage("code", "done", f"{len(stats)} files · +{adds} −{dels}")

    async def heal(self, failure_output, plan, stage, reason):
        kit = Toolkit(self.ws, self.emit, stage, "Coder",
                      on_test_run=lambda r, by, edits: self.record_attempt(r, by, "heal", edits + 1))
        prompt = (
            f"{reason}\n\nDeveloper request:\n\"\"\"\n{self.task['prompt']}\n\"\"\"\n\nPlan:\n{self.plan_brief(plan)}\n\n"
            f"Details:\n{failure_output}\n\nFix the problem with minimal changes and call run_tests until the full "
            "suite passes."
        )
        await run_agent(
            role="coder", name="fixer", instruction=agents.CODER_INSTRUCTION, prompt=prompt, emit=self.emit,
            stage=stage, label="Coder", usage=self.usage, tools=kit.tools(with_run_tests=True), max_llm_calls=35,
        )

    async def test_and_heal(self, plan):
        self.stage("test", "running")
        for attempt in range(1, config.MAX_TEST_ATTEMPTS + 1):
            self.emit("test", "Test Runner", "tool", f"pytest (clean run {attempt}/{config.MAX_TEST_ATTEMPTS})")
            result = await asyncio.to_thread(sandbox.run_tests, self.ws.repo)
            self.record_attempt(result, "Test Runner", "gate")
            if result["ok"]:
                # self-healed = the crew saw red after changing code and fixed it without human help
                healed = any(not a["ok"] and (a["phase"] == "gate" or a.get("afterEdits", 0) > 0)
                             for a in self.attempts if a["phase"] != "tdd")
                self.emit("test", "Test Runner", "success",
                          f"All green: {result['passed']}/{result['total']} tests passed in {result['durationSec']}s"
                          + (" — self-healed after failures" if healed else ""))
                store.update_task(self.id, {"tests.selfHealed": healed})
                self.stage("test", "done", f"{result['passed']}/{result['total']} passed" + (" · healed" if healed else ""))
                return result
            self.emit("test", "Test Runner", "warn", f"Attempt {attempt}: {sandbox.summarize(result)}",
                      result["output"][-3000:])
            if attempt < config.MAX_TEST_ATTEMPTS:
                self.emit("test", "Coder", "info", "Self-healing: analysing the failures and patching the code")
                await self.heal(result["output"][-5000:], plan, "test", "The test suite is failing.")
        raise RuntimeError(f"tests still failing after {config.MAX_TEST_ATTEMPTS} attempts")

    async def review(self, plan):
        self.stage("review", "running")
        review = None
        for round_no in (1, 2):
            diff, _ = self.ws.changes()
            last = self.attempts[-1]["summary"] if self.attempts else "n/a"
            prompt = (
                f"Developer request:\n\"\"\"\n{self.task['prompt']}\n\"\"\"\n\nPlan:\n{self.plan_brief(plan)}\n\n"
                f"Test results: {last}\n\nUnified diff of the change:\n{diff[:60000]}"
            )
            self.emit("review", "Reviewer", "info", f"Reviewing the diff with {config.MODELS['reviewer']} (round {round_no})")
            _, review, model = await run_agent(
                role="reviewer", name="reviewer", instruction=agents.REVIEWER_INSTRUCTION, prompt=prompt,
                emit=self.emit, stage="review", label="Reviewer", usage=self.usage, output_schema=ReviewOut,
            )
            self.models["reviewer"] = model
            blocking = [i for i in review["issues"] if i["severity"] in ("major", "critical")]
            for issue in review["issues"][:8]:
                self.emit("review", "Reviewer", "warn" if issue in blocking else "info",
                          f"[{issue['severity']}] {issue['file']}: {issue['message']}")
            if review["verdict"] == "approve" or not blocking or round_no == 2:
                break
            self.emit("review", "Reviewer", "warn",
                      f"Changes requested ({len(blocking)} blocking issue(s)) — handing back to the Coder")
            issues = "\n".join(f"- [{i['severity']}] {i['file']}: {i['message']}" for i in blocking)
            await self.heal(issues, plan, "review", "The code reviewer requested changes. Address these issues:")
            result = await asyncio.to_thread(sandbox.run_tests, self.ws.repo)
            self.record_attempt(result, "Test Runner", "gate")
            if not result["ok"]:
                raise RuntimeError("tests failed after addressing review feedback")
        review["rounds"] = round_no
        store.update_task(self.id, {"review": review})
        verdict = "approved" if review["verdict"] == "approve" else "changes requested"
        self.emit("review", "Reviewer", "success" if review["verdict"] == "approve" else "warn",
                  f"Review {verdict}: score {review['score']}/100 · {review['risk']} risk — {review['summary'][:300]}")
        self.stage("review", "done", f"{review['score']}/100 · {review['risk']} risk")
        return review

    def commit(self, plan):
        message = (
            f"{plan.get('commit_message') or plan['title']}\n\n{plan['summary']}\n\n"
            f"Requested-by: {self.requester}\nTask: {self.id}\nGenerated-by: Prompt2Prod (Gemini on Vertex AI + ADK)"
        )
        sha = self.ws.commit(message)
        diff, stats = self.ws.changes()
        self.ws.save_bundle()
        store.update_task(self.id, {
            "commit": {"sha": sha, "branch": self.ws.branch, "baseSha": self.ws.base_sha,
                       "message": message.split("\n")[0]},
            "diff": diff[:150_000],
            "files": stats,
        })
        self.emit("review", "Orchestrator", "tool", f"git commit {sha[:7]} on {self.ws.branch}: {message.splitlines()[0]}")

    async def build(self):
        self.stage("build", "running")
        bucket, obj = await asyncio.to_thread(self.ws.source_tarball)
        image = f"{config.IMAGE_REPO}/{self.project['service']}"
        build_id = await asyncio.to_thread(cloud.start_build, bucket, obj, image, self.id, (f"task-{self.id}",))
        log_url = (f"https://console.cloud.google.com/cloud-build/builds;region={config.REGION}/{build_id}"
                   f"?project={config.PROJECT_ID}")
        store.update_task(self.id, {"build": {"id": build_id, "logUrl": log_url}})
        self.emit("build", "Builder", "tool", f"Cloud Build {build_id[:8]} started from gs://{bucket}/{obj}")

        def progress(kind, value, _build):
            if kind == "status":
                self.emit("build", "Builder", "info", f"Cloud Build status: {value}")
            elif value in STEP_MESSAGES:
                self.emit("build", "Builder", "error" if value.endswith("FAILURE") else "info", STEP_MESSAGES[value])

        started = time.time()
        build = await asyncio.to_thread(cloud.wait_for_build, build_id, progress)
        status = cloud.build_status(build)
        if status != "SUCCESS":
            raise RuntimeError(f"Cloud Build {status.lower()}: {build.status_detail or 'see build logs'}")
        image_ref = cloud.built_image_digest(build, image, self.id)
        duration = round(time.time() - started)
        store.update_task(self.id, {"build": {"id": build_id, "logUrl": log_url, "image": image_ref,
                                              "durationSec": duration}})
        self.emit("build", "Builder", "success", f"Image pushed to Artifact Registry in {duration}s", image_ref)
        self.stage("build", "done", f"{duration}s · cached layers")
        return image_ref

    async def preview(self, image_ref):
        self.stage("preview", "running")
        revision = f"{self.project['service']}-{self.id}"
        tag = f"t-{self.id}"
        self.emit("preview", "Deployer", "tool",
                  f"Cloud Run: deploying revision {revision} with tag '{tag}' and 0% production traffic")
        result = await asyncio.to_thread(cloud.deploy_revision, self.project["service"], image_ref, revision, tag)
        url = result["url"]
        if not url:
            raise RuntimeError("Cloud Run did not return a preview URL")
        ready = await self.wait_ready(url)
        store.update_task(self.id, {"preview": {"url": url, "revision": revision, "tag": tag}})
        self.emit("preview", "Deployer", "success" if ready else "warn",
                  f"Preview is live at {url}" + ("" if ready else " (slow to respond)"), url)
        self.stage("preview", "done", "live · 0% prod traffic")
        return url

    async def wait_ready(self, url, timeout=90):
        deadline = time.time() + timeout
        async with httpx.AsyncClient(timeout=15) as http:
            while time.time() < deadline:
                try:
                    res = await http.get(url + "/")
                    if res.status_code < 500:
                        return True
                except httpx.HTTPError:
                    pass
                await asyncio.sleep(2)
        return False

    async def verify(self, plan, url):
        self.stage("verify", "running")
        diff, _ = self.ws.changes()
        files = self.ws.list_files()
        app_files = [f for f in files if not f.startswith("tests/") and f.endswith((".py", ".html", ".js"))]
        prompt = (
            f"Developer request:\n\"\"\"\n{self.task['prompt']}\n\"\"\"\n\nAcceptance criteria:\n"
            + "\n".join(f"- {c}" for c in plan["acceptance_criteria"])
            + f"\n\nPreview URL: {url}\n\nDiff:\n{diff[:40000]}\n\nCurrent application code:\n"
            + self.ws.snapshot(app_files, max_chars=40000)
        )
        _, out, model = await run_agent(
            role="verifier", name="verifier", instruction=agents.VERIFIER_INSTRUCTION, prompt=prompt,
            emit=self.emit, stage="verify", label="Verifier", usage=self.usage, output_schema=VerifyOut,
        )
        self.models["verifier"] = model
        checks = self.sanitize_checks((out or {}).get("checks", []), url)
        results, failures = await self.run_checks(checks, url)
        if failures:
            # Agentic self-correction: show the Verifier what the live app actually returned so it can tell a
            # genuine defect (keep the check failing) from a badly-written check (fix the expectation).
            self.emit("verify", "Verifier", "info",
                      f"Re-examining {len(failures)} failing check(s) against the live responses")
            evidence = json.dumps(failures, indent=2)[:12000]
            retry_prompt = (
                prompt + "\n\nYou already ran these checks against the live preview and they FAILED. Actual responses:\n"
                + evidence + "\n\nReturn the complete list of checks again. If a failure reveals a genuine defect "
                "(the acceptance criteria are not met), keep that check exactly as it was. If the check itself was "
                "wrong (wrong path, method, status or expected text that the correct implementation would never "
                "produce), fix it. Never drop a check just because it fails."
            )
            _, out2, _ = await run_agent(
                role="verifier", name="verifier", instruction=agents.VERIFIER_INSTRUCTION, prompt=retry_prompt,
                emit=self.emit, stage="verify", label="Verifier", usage=self.usage, output_schema=VerifyOut,
            )
            checks2 = self.sanitize_checks((out2 or {}).get("checks", []), url)
            if checks2:
                results, failures = await self.run_checks(checks2, url)
        passed = bool(results) and not failures
        visual = await self.visual_check(plan, url)
        store.update_task(self.id, {"verify": {"passed": passed, "checks": results, **({"visual": visual} if visual else {})}})
        n_ok = sum(r["ok"] for r in results)
        self.stage("verify", "done", f"{n_ok}/{len(results)} live checks passed" + (" · visual ✓" if visual and visual.get("passed") else ""))
        return {"passed": passed, "checks": results}

    async def visual_check(self, plan, url):
        """Screenshot the live preview in headless Chromium and let Gemini (multimodal) judge the UI change."""
        try:
            from playwright.async_api import async_playwright  # noqa: WPS433 — optional dependency
        except ImportError:
            return None
        try:
            self.emit("verify", "Verifier", "tool", "Opening the live preview in headless Chromium for a visual check")
            async with async_playwright() as pw:
                browser = await pw.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
                page = await browser.new_page(viewport={"width": 1280, "height": 860}, device_scale_factor=1)
                await page.goto(url + "/", wait_until="networkidle", timeout=30000)
                await page.wait_for_timeout(800)
                png = await page.screenshot(full_page=False)
                await browser.close()
            blob_name = f"screenshots/{self.id}.png"
            await asyncio.to_thread(lambda: gitrepo.bucket().blob(blob_name).upload_from_string(png, content_type="image/png"))
            from google import genai  # noqa: WPS433
            from google.genai import types as gtypes  # noqa: WPS433

            client = genai.Client()
            model = config.MODELS["verifier"]
            criteria = "\n".join(f"- {c}" for c in plan["acceptance_criteria"])
            response = await client.aio.models.generate_content(
                model=model,
                contents=[gtypes.Part.from_bytes(data=png, mime_type="image/png"),
                          f"Change request:\n{self.task['prompt']}\n\nAcceptance criteria:\n{criteria}"],
                config=gtypes.GenerateContentConfig(
                    system_instruction=agents.VISUAL_INSTRUCTION, response_mime_type="application/json",
                    response_schema=agents.VisualOut, temperature=0.1,
                    thinking_config=gtypes.ThinkingConfig(thinking_level="LOW"),
                ),
            )
            self.usage.add(model, response.usage_metadata)
            verdict = agents.VisualOut.model_validate_json(response.text).model_dump()
            verdict["screenshot"] = f"/api/tasks/{self.id}/screenshot"
            if not verdict["applicable"]:
                self.emit("verify", "Verifier", "info", f"Visual check (Gemini multimodal): no visible change expected — {verdict['summary']}")
            else:
                self.emit("verify", "Verifier", "success" if verdict["passed"] else "warn",
                          f"Visual check (Gemini multimodal) {'✓' if verdict['passed'] else '✗'} {verdict['summary']}",
                          "\n".join(f"• {o}" for o in verdict["observations"]))
            return verdict
        except Exception as exc:  # noqa: BLE001 — visual QA is advisory and must never break a release
            self.emit("verify", "Verifier", "info", f"Visual check skipped: {str(exc)[:120]}")
            return None

    def sanitize_checks(self, raw, url):
        base = urlparse(url)
        checks = []
        for check in raw[:8]:
            path = (check.get("path") or "").strip()
            if path.startswith(("http://", "https://")):
                parsed = urlparse(path)
                if parsed.netloc != base.netloc:
                    self.emit("verify", "Verifier", "info", f"Skipped off-site check: {check.get('name')}")
                    continue
                path = (parsed.path or "/") + (f"?{parsed.query}" if parsed.query else "")
            if path.lower().startswith(("javascript:", "#")) or " " in path:
                self.emit("verify", "Verifier", "info", f"Skipped a non-HTTP check: {check.get('name')}")
                continue
            check["path"] = "/" + path.lstrip("/")
            checks.append(check)
        return checks

    async def run_checks(self, checks, url):
        results, failures = [], []
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as http:
            for check in checks:
                started = time.time()
                status_code, ok, detail, excerpt = None, False, "", ""
                try:
                    body = json.loads(check["json_body"]) if check.get("json_body") else None
                    res = await http.request(check["method"], url + check["path"], json=body)
                    status_code = res.status_code
                    excerpt = res.text[:700]
                    missing = [s for s in check.get("expect_contains", []) if not body_contains(res, s)]
                    ok = status_code == check["expect_status"] and not missing
                    if status_code != check["expect_status"]:
                        detail = f"expected {check['expect_status']}, got {status_code}"
                    elif missing:
                        detail = "missing in body: " + ", ".join(repr(m) for m in missing)
                    else:
                        found = check.get("expect_contains") or []
                        detail = ("found " + ", ".join(repr(f) for f in found[:3])) if found else "status ok"
                except Exception as exc:  # noqa: BLE001
                    detail = str(exc)[:200]
                ms = round((time.time() - started) * 1000)
                results.append({"name": check["name"], "method": check["method"], "path": check["path"],
                                "expectStatus": check["expect_status"], "status": status_code, "ok": ok,
                                "ms": ms, "detail": detail})
                if not ok:
                    failures.append({**check, "actual_status": status_code, "problem": detail,
                                     "actual_body_excerpt": excerpt})
                self.emit("verify", "Verifier", "success" if ok else "warn",
                          f"{'✓' if ok else '✗'} {check['name']} — {check['method']} {check['path']} → "
                          f"{status_code} ({ms} ms)", None if ok else detail)
        return results, failures

    async def release(self, review, verify, url):
        self.stage("release", "running")
        reasons = []
        if review["verdict"] != "approve":
            reasons.append("reviewer requested changes")
        if review["risk"] == "high":
            reasons.append("high-risk change")
        if not verify["passed"]:
            failed = sum(not c["ok"] for c in verify["checks"]) or "all"
            reasons.append(f"{failed} live check(s) failed")
        mode = self.task.get("mode", "autopilot")
        if mode == "autopilot" and not reasons:
            self.emit("release", "Release Manager", "info",
                      "Autopilot gate passed — tests ✓ · AI review ✓ · live checks ✓. Promoting to production")
            fresh = store.get_task(self.id)
            await asyncio.to_thread(release.promote, fresh, "autopilot", self.log)
            self.finish("deployed")
            return "deployed"
        why = "approval mode is on" if mode == "approval" else "; ".join(reasons)
        self.emit("release", "Release Manager", "warn" if reasons else "info",
                  f"Waiting for human approval ({why}). Try the preview, then Approve & release.", url)
        self.stage("release", "waiting", f"awaiting approval · {why}")
        self.finish("awaiting_approval")
        return "awaiting_approval"
