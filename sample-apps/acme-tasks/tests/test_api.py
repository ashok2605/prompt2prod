def test_health(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.get_json()["status"] == "ok"


def test_list_tasks_is_seeded(client):
    res = client.get("/api/tasks")
    assert res.status_code == 200
    data = res.get_json()
    assert data["count"] == 5
    assert data["tasks"][0]["title"] == "Draft Q4 roadmap"


def test_filter_by_done(client):
    done = client.get("/api/tasks?done=true").get_json()["tasks"]
    assert done and all(t["done"] for t in done)


def test_create_task(client):
    res = client.post("/api/tasks", json={"title": "Write release notes", "assignee": "Ana"})
    assert res.status_code == 201
    task = res.get_json()
    assert task["title"] == "Write release notes"
    assert task["assignee"] == "Ana"
    assert task["done"] is False


def test_get_task(client):
    res = client.get("/api/tasks/1")
    assert res.status_code == 200
    assert res.get_json()["id"] == 1


def test_get_missing_task_returns_404(client):
    res = client.get("/api/tasks/999")
    assert res.status_code == 404
    assert "error" in res.get_json()


def test_toggle_done(client):
    res = client.patch("/api/tasks/1", json={"done": True})
    assert res.status_code == 200
    assert res.get_json()["done"] is True


def test_delete_task(client):
    assert client.delete("/api/tasks/2").status_code == 204
    assert client.get("/api/tasks/2").status_code == 404
