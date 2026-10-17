def test_index_renders_tasks(client):
    res = client.get("/")
    assert res.status_code == 200
    html = res.get_data(as_text=True)
    assert "Acme Tasks" in html
    assert "Draft Q4 roadmap" in html
