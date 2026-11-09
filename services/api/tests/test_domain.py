"""D(데이터·시간 경계)와 V(독립 검증기) 인수 테스트."""

import os
import subprocess
import sys

import pytest
from pydantic import ValidationError

from app.contracts import Catalog, Meeting
from app.domain.catalog import (
    CatalogIndex,
    CreditParseError,
    credit_to_units,
    overlaps,
    parse_hhmm,
    sections_conflict,
    validate_catalog_semantics,
)
from app.domain.validator import validate_selection
from tests.helpers import con, credit, load_catalog


def mt(day, s, e, campus=True):
    return Meeting(day=day, start_minute=s, end_minute=e, campus_required=campus)


def sec(sid, course, meetings, mode="in_person", **kw):
    return {
        "id": sid,
        "course_id": course,
        "section_label": kw.get("label", "01"),
        "instructor_ids": kw.get("inst", []),
        "delivery_mode": mode,
        "meetings": meetings,
        "support_status": kw.get("status", "supported"),
        "issue_codes": kw.get("issues", []),
    }


def m(day, s, e, campus=True):
    return {"day": day, "start_minute": s, "end_minute": e, "room": None, "campus_required": campus}


def catalog(courses, sections, instructors=(), groups=None):
    return Catalog.model_validate(
        {"catalog_id": "t", "term_id": "t", "category_groups": groups or {}, "courses": courses, "instructors": list(instructors), "sections": sections}
    )


def course(cid, units=300, cats=(), eq=None):
    return {"id": cid, "name": cid, "credit_units": units, "category_ids": list(cats), "equivalence_group_id": eq}


# ---------------------------------------------------------------- D
def test_D01_adjacent_no_conflict():
    assert not overlaps(mt("Mon", 540, 600), mt("Mon", 600, 660))


def test_D02_overlap_conflict():
    assert overlaps(mt("Mon", parse_hhmm("09:10", is_end=False), parse_hhmm("10:25", is_end=True)), mt("Mon", parse_hhmm("10:20", is_end=False), 660))


def test_D03_other_day():
    assert not overlaps(mt("Mon", 540, 600), mt("Tue", 540, 600))


def test_D04_second_meeting_checked():
    c = catalog([course("X"), course("Y")], [sec("X1", "X", [m("Mon", 540, 600), m("Wed", 540, 600)]), sec("Y1", "Y", [m("Wed", 570, 630)])])
    idx = CatalogIndex.build(c)
    assert sections_conflict(idx.section_by_id["X1"], idx.section_by_id["Y1"])
    v = validate_selection(idx, ["X1", "Y1"], [], ["X1", "Y1"])
    assert any(x.startswith("TIME_CONFLICT") for x in v.structural_violations)


def test_D05_credit_once_multi_meetings():
    c = catalog([course("X", units=credit_to_units("1.5"))], [sec("X1", "X", [m("Mon", 540, 600), m("Wed", 540, 600)])])
    v = validate_selection(CatalogIndex.build(c), ["X1"], [], ["X1"])
    assert v.total_credit_units == 150


@pytest.mark.parametrize("s,e", [(600, 540), (600, 600), (-10, 60), (1380, 1441), (1440, 1440)])
def test_D06_bad_intervals_rejected(s, e):
    with pytest.raises(ValidationError):
        Meeting(day="Mon", start_minute=s, end_minute=e, campus_required=True)


def test_D06_time_text():
    with pytest.raises(ValueError):
        parse_hhmm("24:01", is_end=True)
    with pytest.raises(ValueError):
        parse_hhmm("24:00", is_end=False)
    with pytest.raises(ValueError):
        parse_hhmm("3교시", is_end=False)  # D-14: 교시 추정 금지


def test_D07_end_2400_valid():
    assert parse_hhmm("24:00", is_end=True) == 1440
    Meeting(day="Mon", start_minute=1380, end_minute=1440, campus_required=True)


def test_D08_tbd_must_be_unsupported():
    c = catalog([course("X")], [sec("X1", "X", [])])
    errs, _ = validate_catalog_semantics(c)
    assert any(e.code == "MEETINGS_REQUIRED" for e in errs)
    c2 = catalog([course("X")], [sec("X1", "X", [], status="unsupported", issues=["TIME_TBD"])])
    assert validate_catalog_semantics(c2)[0] == []


def test_D09_async_no_conflict_credit_counted():
    c = catalog([course("X"), course("Y")], [sec("X1", "X", [], mode="online_async"), sec("Y1", "Y", [m("Mon", 540, 600)])])
    assert validate_catalog_semantics(c)[0] == []
    v = validate_selection(CatalogIndex.build(c), ["X1", "Y1"], [], ["X1", "Y1"])
    assert v.hard_ok and v.total_credit_units == 600


def test_D10_duplicate_section_id():
    c = catalog([course("X")], [sec("X1", "X", [m("Mon", 540, 600)]), sec("X1", "X", [m("Tue", 540, 600)])])
    assert any(e.code == "DUPLICATE_SECTION_ID" for e in validate_catalog_semantics(c)[0])


def test_D13_label_string():
    c = catalog([course("X")], [sec("X1", "X", [m("Mon", 540, 600)], label="01")])
    assert c.sections[0].section_label == "01"


def test_D15_category_union_counted_once():
    c = catalog([course("X", cats=["major_required", "major_elective"])], [sec("X1", "X", [m("Mon", 540, 600)])])
    cmin = con("c", "category_min", category_ids=["major_required", "major_elective"], min_units=600)
    v = validate_selection(CatalogIndex.build(c), ["X1"], [cmin], ["X1"])
    assert v.evaluations[0].violation == 300  # 600이 아니라 300만 집계


def test_D17_intra_section_overlap():
    c = catalog([course("X")], [sec("X1", "X", [m("Mon", 540, 600), m("Mon", 570, 630)])])
    assert any(e.code == "INTRA_SECTION_OVERLAP" for e in validate_catalog_semantics(c)[0])


def test_D20_precision():
    assert credit_to_units("1.5") == 150
    assert credit_to_units("3") == 300
    with pytest.raises(CreditParseError):
        credit_to_units("1.005")


def test_strict_no_extra_fields_no_bool_as_int():
    with pytest.raises(ValidationError):
        Meeting.model_validate({"day": "Mon", "start_minute": 1, "end_minute": 2, "campus_required": True, "x": 1})
    with pytest.raises(ValidationError):
        Meeting.model_validate({"day": "Mon", "start_minute": True, "end_minute": 2, "campus_required": True})


# ---------------------------------------------------------------- V
@pytest.fixture
def tiny():
    c = load_catalog()
    return c, CatalogIndex.build(c), [s.id for s in c.sections]


def test_V01_unknown_id(tiny):
    _, idx, allowed = tiny
    v = validate_selection(idx, allowed, [], ["A1", "Z9"])
    assert not v.hard_ok and any("UNKNOWN_SECTION_ID" in x for x in v.hard_violations)


def test_V02_duplicate_id(tiny):
    _, idx, allowed = tiny
    assert "DUPLICATE_SELECTED_ID" in validate_selection(idx, allowed, [], ["A1", "A1"]).hard_violations


def test_V03_same_course_twice(tiny):
    _, idx, allowed = tiny
    assert any("MULTIPLE_SECTIONS_SAME_COURSE" in x for x in validate_selection(idx, allowed, [], ["A1", "A2"]).hard_violations)


def test_V04_equivalence_group():
    c = catalog([course("X", eq="g"), course("Y", eq="g")], [sec("X1", "X", [m("Mon", 540, 600)]), sec("Y1", "Y", [m("Tue", 540, 600)])])
    v = validate_selection(CatalogIndex.build(c), ["X1", "Y1"], [], ["X1", "Y1"])
    assert any("EQUIVALENCE_GROUP_DUPLICATE" in x for x in v.hard_violations)


def test_V05_empty_allowed(tiny):
    _, idx, _ = tiny
    assert not validate_selection(idx, [], [], ["A1"]).hard_ok


def test_V06_not_allowed(tiny):
    _, idx, _ = tiny
    assert "NOT_ALLOWED:A1" in validate_selection(idx, ["A2"], [], ["A1"]).hard_violations


def test_V07_hard_credit(tiny):
    _, idx, allowed = tiny
    v = validate_selection(idx, allowed, [credit(600, 600)], ["A1"])
    assert not v.hard_ok and v.evaluations[0].violation == 300


def test_V08_must_include_restricted(tiny):
    _, idx, allowed = tiny
    c = con("i", "must_include", course_id="A", allowed_section_ids=["A2"])
    assert not validate_selection(idx, allowed, [c], ["A1"]).evaluations[0].satisfied


def test_V09_category_min(tiny):
    _, idx, allowed = tiny
    c = con("c", "category_min", category_ids=["major_required", "major_elective"], min_units=600)
    assert validate_selection(idx, allowed, [c], ["A1", "B1"]).evaluations[0].satisfied


def test_V10_no_cumulative(tiny):
    # 이미 이수한 학점은 입력에 존재하지 않는다: 현재 선택 300만으로 600 미충족
    _, idx, allowed = tiny
    c = con("c", "category_min", category_ids=["major_required"], min_units=600)
    assert not validate_selection(idx, allowed, [c], ["A1"]).evaluations[0].satisfied


def test_V11_online_sync_day_off_but_not_campus():
    c = catalog([course("X")], [sec("X1", "X", [m("Mon", 540, 600, campus=False)], mode="online_sync")])
    idx = CatalogIndex.build(c)
    v = validate_selection(idx, ["X1"], [con("d", "day_off", days=["Mon"]), con("k", "max_days_on_campus", max_days=0)], ["X1"])
    assert not v.evaluations[0].satisfied
    assert v.evaluations[1].satisfied


def test_V12_no_soft(tiny):
    _, idx, allowed = tiny
    v = validate_selection(idx, allowed, [credit(300, 600)], ["A1"])
    assert v.score is None and v.penalty == 0


def test_validator_does_not_import_ortools():
    code = "import sys, app.domain.validator, app.domain.facts; print('ortools' in sys.modules)"
    # 자식 프로세스 출력은 UTF-8로 명시(Windows 기본 CP949에 의존하지 않음)
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, encoding="utf-8", check=True, env=env)
    assert out.stdout.strip() == "False"
