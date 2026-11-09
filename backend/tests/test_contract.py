import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import app, create_app

client = TestClient(app)

ONE_COURSE = {
    "courses": [{"id": "C1", "name": "과목", "credit": 3, "category": "전선"}],
    "sections": [],
}
POOL = [{"course_id": "C1"}]

EMPTY_RESULT = {
    "status": "INFEASIBLE",
    "candidates": [],
    "stats": {"solve_ms": 0, "n_sections_after_filter": 0},
}

STUB_REQUESTS = {
    "/catalog/validate": {"courses": [], "sections": []},
    "/profile/parse": {"consent": True, "rows": []},
}


def test_explain_answers_without_llm():
    body = {"catalog": {"courses": [], "sections": []}, "result": EMPTY_RESULT}
    r = client.post("/explain", json=body)
    assert r.status_code == 200 and r.json()["candidate_explanations"] == []


def test_openapi_exposes_the_contract():
    paths = app.openapi()["paths"]
    assert "/health" in paths
    for p in STUB_REQUESTS:
        assert "post" in paths[p], p


@pytest.mark.parametrize("path,body", STUB_REQUESTS.items())
def test_stubs_return_unified_501(path, body):
    r = client.post(path, json=body)
    assert r.status_code == 501
    assert r.json()["error"]["code"] == "not_implemented"


def test_validation_error_never_echoes_input():
    body = {
        "catalog": {
            "courses": [],
            "sections": [{"id": "SECRET-SECTION", "course_id": "nope", "meetings": []}],
        }
    }
    r = client.post("/solve", json=body)
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "validation_error"
    assert all(set(d) <= {"loc", "msg", "type"} for d in err["details"])
    assert "input" not in r.text


def test_profile_parse_requires_consent():
    r = client.post("/profile/parse", json={"consent": False, "rows": []})
    assert r.status_code == 422


def test_duplicate_constraint_ids_rejected():
    c = {
        "id": "c1",
        "type": "day_off",
        "strength": "soft",
        "params": {"days": ["Fri"]},
    }
    r = client.post("/solve", json={"catalog": ONE_COURSE, "pool": POOL, "constraints": [c, c]})
    assert r.status_code == 422


@pytest.mark.parametrize(
    "pool",
    [[], [{"course_id": "C1"}, {"course_id": "C1"}], [{"course_id": "NOPE"}]],
    ids=["empty", "duplicate", "unknown"],
)
def test_pool_is_required_unique_and_known(pool):
    r = client.post("/solve", json={"catalog": ONE_COURSE, "pool": pool})
    assert r.status_code == 422


def test_pool_priority_defaults_and_bounds():
    ok = client.post("/solve", json={"catalog": ONE_COURSE, "pool": [{"course_id": "C1"}]})
    assert ok.status_code == 200
    assert ok.json()["status"] == "OPTIMAL"  # a course without sections: empty timetable
    bad = [{"course_id": "C1", "priority": 6}]
    assert client.post("/solve", json={"catalog": ONE_COURSE, "pool": bad}).status_code == 422


def test_input_length_guard():
    small = TestClient(create_app(Settings(_env_file=None, max_input_chars=10)))
    r = small.post("/constraints/parse", json={"text": "x" * 11})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "input_too_long"
