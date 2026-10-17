"""The agents' file tools must never escape the task repository."""
import pytest

from p2p.gitrepo import Workspace, git, line_delta


@pytest.fixture()
def ws(tmp_path, monkeypatch):
    monkeypatch.setattr("p2p.config.WORK_ROOT", str(tmp_path))
    w = Workspace("demo", "t1")
    (tmp_path / "t1" / "repo").mkdir(parents=True)
    w.repo = str(tmp_path / "t1" / "repo")
    git(["init", "-q", "-b", "main"], cwd=w.repo)
    (tmp_path / "t1" / "repo" / "app.py").write_text("print('hi')\n")
    git(["add", "-A"], cwd=w.repo)
    git(["commit", "-q", "-m", "init"], cwd=w.repo)
    w.base_sha = git(["rev-parse", "HEAD"], cwd=w.repo).strip()
    return w


@pytest.mark.parametrize("bad", ["../secrets.txt", ".git/config", "", ".", "a/../../x", "../../etc/passwd"])
def test_resolve_blocks_escapes(ws, bad):
    with pytest.raises(ValueError):
        ws.resolve(bad)


def test_absolute_paths_are_repo_relative(ws):
    # agents often write "/app.py"; it must land inside the repository, never at the filesystem root
    rel, full = ws.resolve("/etc/passwd")
    assert rel == "etc/passwd" and full.startswith(ws.repo)


def test_write_read_and_changes(ws):
    ws.write("templates/new.html", "<p>hello</p>\n")
    ws.write("app.py", "print('hello')\n")
    assert ws.read("templates/new.html") == "<p>hello</p>\n"
    diff, stats = ws.changes()
    by_path = {s["path"]: s for s in stats}
    assert by_path["templates/new.html"]["status"] == "A"
    assert by_path["app.py"]["status"] == "M"
    assert "+print('hello')" in diff


def test_commit_requires_changes(ws):
    with pytest.raises(Exception):
        ws.commit("nothing")
    ws.write("app.py", "print('changed')\n")
    assert len(ws.commit("feat: change")) == 40


def test_line_delta():
    assert line_delta("a\nb\n", "a\nc\nd\n") == (2, 1)
