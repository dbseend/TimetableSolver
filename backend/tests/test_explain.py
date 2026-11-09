import json

from app.domain.api_models import ExplainRequest
from app.llm.explain import explain

CATALOG = {
    "courses": [
        {"id": "A", "name": "가상과목 알파", "credit": 3, "category": "전선"},
        {"id": "B", "name": "가상과목 베타", "credit": 2, "category": "교양"},
    ],
    "sections": [
        {
            "id": "A-01",
            "course_id": "A",
            "meetings": [{"day": "Mon", "start": "09:00", "end": "10:15"}],
        },
        {
            "id": "B-01",
            "course_id": "B",
            "meetings": [{"day": "Fri", "start": "12:00", "end": "12:50"}],
        },
    ],
}
RULES = [
    {"id": "c1", "type": "day_off", "strength": "soft", "params": {"days": ["Fri"]},
     "source_text": "금요일엔 수업 없었으면"},
    {"id": "c2", "type": "credit_range", "strength": "hard", "params": {"min": 3, "max": 6}},
]  # fmt: skip


def request(sections=("A-01", "B-01"), violated=(("c1", 1),), diagnosis=None):
    result = {
        "status": "INFEASIBLE" if diagnosis else "OPTIMAL",
        "candidates": []
        if diagnosis
        else [
            {
                "sections": list(sections),
                "objective": 0,
                "satisfied": ["c2"],
                "violated": [{"id": i, "amount": a} for i, a in violated],
            }
        ],
        "diagnosis": diagnosis,
        "stats": {"solve_ms": 1, "n_sections_after_filter": 2},
    }
    return ExplainRequest.model_validate(
        {"catalog": CATALOG, "constraints": RULES, "result": result}
    )


class Fake:
    model = "fake"

    def __init__(self, reply: dict) -> None:
        self.reply = reply

    def generate_json(self, system, user, schema):
        return json.dumps(self.reply, ensure_ascii=False)


def test_template_states_credits_days_and_missed_preferences():
    r = explain(request(), None)
    assert r.candidate_explanations == [
        "후보 1: 5학점, 2과목, 월·금 등교. 못 지킨 선호: 금요일엔 수업 없었으면 (1일)."
    ]
    assert r.sources == ["template"]


def test_template_diagnosis_names_conflicts_and_fix():
    diagnosis = {"core": ["c1", "c2"], "relaxations": [{"drop": "c1", "feasible": True}]}
    r = explain(request(diagnosis=diagnosis), None)
    assert "금요일엔 수업 없었으면, 총 3–6학점" in r.diagnosis_text
    assert "금요일엔 수업 없었으면을(를) 빼면" in r.diagnosis_text


def test_grounded_llm_rewrite_is_used():
    good = "알파(월 09:00)와 베타로 5학점이다. 금요일 12:00 수업이 있어 금요일 공강은 못 지켰다."
    r = explain(request(), Fake({"candidate_explanations": [good]}))
    assert r.candidate_explanations == [good] and r.sources == ["llm"]


def test_ungrounded_rewrites_fall_back_to_template():
    for bad in (
        "월 10:30 수업이 있다.",  # time not in the facts
        "총 6학점이다.",  # credits other than the candidate's total
        "가상과목 알파와 가상과목 베타를 넣었다.",  # fine: both chosen
    ):
        r = explain(request(), Fake({"candidate_explanations": [bad]}))
        assert r.sources == (["llm"] if "베타를" in bad else ["template"]), bad


def test_unchosen_catalog_course_falls_back():
    fake = Fake({"candidate_explanations": ["가상과목 베타도 넣었다."]})
    r = explain(request(sections=["A-01"], violated=()), fake)
    assert r.sources == ["template"]


def test_llm_failure_keeps_templates():
    class Broken(Fake):
        def generate_json(self, *a):
            return "not json"

    r = explain(request(), Broken({}))
    assert r.sources == ["template"]
