"""Live smoke checks must tolerate JSON spacing and HTML escaping differences."""
from p2p.pipeline import body_contains


class FakeResponse:
    def __init__(self, text, data=None):
        self.text = text
        self._data = data

    def json(self):
        if self._data is None:
            raise ValueError("not json")
        return self._data


def test_compact_json_matches_spaced_expectation():
    res = FakeResponse('{"priority":"high","title":"x"}', {"priority": "high", "title": "x"})
    assert body_contains(res, '"priority": "high"')
    assert body_contains(res, '"priority":"high"')


def test_html_escaping_is_tolerated():
    res = FakeResponse("<span>Acme&#39;s tasks</span>")
    assert body_contains(res, "Acme's tasks")


def test_missing_text_fails():
    res = FakeResponse("<p>nothing here</p>")
    assert not body_contains(res, "priority-badge")
