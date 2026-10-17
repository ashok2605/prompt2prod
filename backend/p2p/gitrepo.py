"""Git workspaces backed by git bundles stored in Cloud Storage.

Layout in the bucket:
  repos/<project>/main.bundle        production history (branch `main`)
  repos/<project>/baseline.bundle    pristine demo baseline (for resets)
  repos/<project>/tasks/<task>.bundle   `main` + `task/<task>` after the crew commits
  sources/<task>.tgz                 build context handed to Cloud Build
"""
import difflib
import os
import shutil
import subprocess
import tempfile

from google.cloud import storage

from . import config

BOT_NAME = "Prompt2Prod Crew"
BOT_EMAIL = "crew@prompt2prod.dev"
TEXT_LIMIT = 200_000

_gcs = None


class GitError(RuntimeError):
    pass


class ConflictError(RuntimeError):
    pass


def bucket():
    global _gcs
    if _gcs is None:
        _gcs = storage.Client(project=config.PROJECT_ID)
    return _gcs.bucket(config.BUCKET)


def main_bundle(project_id):
    return f"repos/{project_id}/main.bundle"


def baseline_bundle(project_id):
    return f"repos/{project_id}/baseline.bundle"


def task_bundle(project_id, task_id):
    return f"repos/{project_id}/tasks/{task_id}.bundle"


def git(args, cwd, check=True):
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": BOT_NAME,
        "GIT_AUTHOR_EMAIL": BOT_EMAIL,
        "GIT_COMMITTER_NAME": BOT_NAME,
        "GIT_COMMITTER_EMAIL": BOT_EMAIL,
        "GIT_TERMINAL_PROMPT": "0",
    }
    proc = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, env=env)
    if check and proc.returncode != 0:
        raise GitError(f"git {' '.join(args)} failed: {proc.stderr.strip() or proc.stdout.strip()}")
    return proc.stdout


def _download(blob_path, dest):
    blob = bucket().blob(blob_path)
    blob.reload()
    blob.download_to_filename(dest)
    return blob.generation


def _upload(path, blob_path, if_generation_match=None):
    blob = bucket().blob(blob_path)
    kwargs = {}
    if if_generation_match is not None:
        kwargs["if_generation_match"] = if_generation_match
    blob.upload_from_filename(path, **kwargs)


class Workspace:
    """A checkout of a project's `main` on a fresh `task/<id>` branch."""

    def __init__(self, project_id, task_id):
        self.project_id = project_id
        self.task_id = task_id
        self.root = os.path.join(config.WORK_ROOT, task_id)
        self.repo = os.path.join(self.root, "repo")
        self.branch = f"task/{task_id}"
        self.base_sha = None

    # ------------------------------------------------------------ lifecycle
    def restore(self):
        shutil.rmtree(self.root, ignore_errors=True)
        os.makedirs(self.root, exist_ok=True)
        bundle = os.path.join(self.root, "main.bundle")
        _download(main_bundle(self.project_id), bundle)
        git(["clone", "--quiet", "--branch", "main", bundle, self.repo], cwd=self.root)
        git(["checkout", "--quiet", "-b", self.branch], cwd=self.repo)
        self.base_sha = git(["rev-parse", "HEAD"], cwd=self.repo).strip()
        return self.base_sha

    def cleanup(self):
        shutil.rmtree(self.root, ignore_errors=True)

    # ------------------------------------------------------------ file access
    def resolve(self, path):
        rel = os.path.normpath((path or "").strip().lstrip("/"))
        if rel in ("", ".") or rel.startswith(".."):
            raise ValueError(f"invalid path: {path!r}")
        if rel == ".git" or rel.startswith(".git/"):
            raise ValueError(".git is off-limits")
        full = os.path.join(self.repo, rel)
        if not os.path.realpath(full).startswith(os.path.realpath(self.repo) + os.sep):
            raise ValueError(f"path escapes the repository: {path!r}")
        return rel, full

    def list_files(self):
        out = git(["ls-files", "--cached", "--others", "--exclude-standard"], cwd=self.repo)
        return sorted({line for line in out.splitlines() if line and os.path.exists(os.path.join(self.repo, line))})

    def read(self, path):
        _, full = self.resolve(path)
        with open(full, "r", encoding="utf-8", errors="replace") as fh:
            return fh.read()

    def read_or_empty(self, path):
        try:
            return self.read(path)
        except FileNotFoundError:
            return ""

    def write(self, path, content):
        rel, full = self.resolve(path)
        if len(content) > TEXT_LIMIT:
            raise ValueError("file too large")
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as fh:
            fh.write(content)
        return rel

    def delete(self, path):
        _, full = self.resolve(path)
        os.remove(full)

    def snapshot(self, paths=None, max_chars=80_000):
        """Concatenate repository files (or a subset) for prompting."""
        chunks, used = [], 0
        for rel in paths or self.list_files():
            try:
                content = self.read(rel)
            except (FileNotFoundError, ValueError, IsADirectoryError):
                continue
            block = f"===== {rel} =====\n{content}\n"
            if used + len(block) > max_chars:
                chunks.append(f"===== {rel} ===== (omitted, use read_file)\n")
                continue
            chunks.append(block)
            used += len(block)
        return "".join(chunks)

    # ------------------------------------------------------------ changes
    def changes(self):
        """Return (unified diff vs base, [file stats]) including new/deleted files."""
        git(["add", "-A"], cwd=self.repo)
        diff = git(["diff", "--cached", "--no-color", "-M", self.base_sha], cwd=self.repo)
        stats = []
        numstat = git(["diff", "--cached", "--numstat", "-M", self.base_sha], cwd=self.repo).splitlines()
        status = {}
        for line in git(["diff", "--cached", "--name-status", "-M", self.base_sha], cwd=self.repo).splitlines():
            cols = line.split("\t")
            if len(cols) >= 2:
                status[cols[-1]] = cols[0][0]
        for line in numstat:
            parts = line.split("\t")
            if len(parts) < 3:
                continue
            adds, dels, path = parts[0], parts[1], parts[-1]
            if "=>" in path:
                path = path.split("=>")[-1].strip(" }")
            stats.append({
                "path": path,
                "status": {"A": "A", "D": "D", "R": "M"}.get(status.get(path, "M"), "M"),
                "additions": int(adds) if adds.isdigit() else 0,
                "deletions": int(dels) if dels.isdigit() else 0,
            })
        return diff, stats

    def commit(self, message):
        git(["add", "-A"], cwd=self.repo)
        if not git(["status", "--porcelain"], cwd=self.repo).strip():
            raise GitError("no changes to commit")
        git(["commit", "--quiet", "-m", message], cwd=self.repo)
        return git(["rev-parse", "HEAD"], cwd=self.repo).strip()

    def save_bundle(self):
        path = os.path.join(self.root, "task.bundle")
        git(["bundle", "create", path, "main", self.branch], cwd=self.repo)
        _upload(path, task_bundle(self.project_id, self.task_id))
        return f"gs://{config.BUCKET}/{task_bundle(self.project_id, self.task_id)}"

    def source_tarball(self):
        path = os.path.join(self.root, "source.tgz")
        git(["archive", "--format=tar.gz", "-o", path, "HEAD"], cwd=self.repo)
        obj = f"sources/{self.task_id}.tgz"
        _upload(path, obj)
        return config.BUCKET, obj


def line_delta(before, after):
    adds = dels = 0
    for line in difflib.ndiff(before.splitlines(), after.splitlines()):
        if line.startswith("+ "):
            adds += 1
        elif line.startswith("- "):
            dels += 1
    return adds, dels


# ---------------------------------------------------------------- release ops

def promote_task_branch(project_id, task_id):
    """Fast-forward `main` to the task branch and publish the new main bundle."""
    with tempfile.TemporaryDirectory() as tmp:
        main_path = os.path.join(tmp, "main.bundle")
        generation = _download(main_bundle(project_id), main_path)
        task_path = os.path.join(tmp, "task.bundle")
        _download(task_bundle(project_id, task_id), task_path)
        repo = os.path.join(tmp, "repo")
        git(["clone", "--quiet", "--branch", "main", main_path, repo], cwd=tmp)
        git(["fetch", "--quiet", task_path, f"task/{task_id}:task/{task_id}"], cwd=repo)
        try:
            git(["merge", "--ff-only", "--quiet", f"task/{task_id}"], cwd=repo)
        except GitError as exc:
            raise ConflictError(
                "Production moved on since this task started; retry the task to rebase it on the latest main."
            ) from exc
        sha = git(["rev-parse", "HEAD"], cwd=repo).strip()
        out = os.path.join(tmp, "new-main.bundle")
        git(["bundle", "create", out, "main"], cwd=repo)
        _upload(out, main_bundle(project_id), if_generation_match=generation)
        return sha


def reset_main(project_id, sha):
    """Point `main` back at an earlier commit (used by rollbacks)."""
    with tempfile.TemporaryDirectory() as tmp:
        main_path = os.path.join(tmp, "main.bundle")
        generation = _download(main_bundle(project_id), main_path)
        repo = os.path.join(tmp, "repo")
        git(["clone", "--quiet", "--branch", "main", main_path, repo], cwd=tmp)
        git(["reset", "--quiet", "--hard", sha], cwd=repo)
        out = os.path.join(tmp, "new-main.bundle")
        git(["bundle", "create", out, "main"], cwd=repo)
        _upload(out, main_bundle(project_id), if_generation_match=generation)
        return sha


def reset_to_baseline(project_id):
    src = bucket().blob(baseline_bundle(project_id))
    bucket().copy_blob(src, bucket(), main_bundle(project_id))


def main_head(project_id):
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "main.bundle")
        _download(main_bundle(project_id), path)
        out = git(["bundle", "list-heads", path], cwd=tmp)
        for line in out.splitlines():
            sha, ref = line.split(" ", 1)
            if ref.strip() == "refs/heads/main":
                return sha
    return None
