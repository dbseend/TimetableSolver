"""반례 테스트: main의 lunch_free / max_gap / max_consecutive 판정(main:app/validation/validator.check)을
현재 명세(TimetableSolver docs/02-architecture.md §4.5)의 정의와 비교한다.

명세 정의(참조 구현 spec_*):
- lunch_free(days, window_start, window_end, min_free_minutes): 각 지정일 창 안에 '연속' 빈 구간이 최소 길이 이상 존재.
  수업이 없는 날도 창 길이가 충분하면 충족.
- max_gap(days, max_minutes): 각 지정일, 시간순 인접 선택 Meeting 사이 최장 단일 빈 구간(분) <= max.
- max_consecutive(days, max_minutes, break_reset_minutes=20): 쉬는 시간이 reset 이상이면 체인을 끊고,
  각 체인의 처음 시작~끝 종료 길이(분) <= max. 단일 긴 수업도 상한을 넘을 수 있다.

각 테스트는 '명세 판정'과 'main 판정'을 둘 다 계산하고, 둘이 다르다는 사실을 단언한다(반례).
main 코드는 수정하지 않는다. 이 파일은 scratch 사본에서만 실행한다.
"""

from app.domain.constraints import constraint_adapter
from app.domain.models import Catalog
from app.validation.validator import check


def hm(t: str) -> int:
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def catalog(meetings_by_section: dict[str, list[tuple[str, str, str]]], credit: float = 3) -> Catalog:
    courses, sections = [], []
    for i, (sid, ms) in enumerate(meetings_by_section.items()):
        cid = f"C{i}"
        courses.append({"id": cid, "name": cid, "credit": credit, "category": "전선"})
        sections.append({"id": sid, "course_id": cid, "meetings": [{"day": d, "start": s, "end": e} for d, s, e in ms]})
    return Catalog.model_validate({"courses": courses, "sections": sections})


def main_ok(cat: Catalog, ctype: str, params: dict) -> bool:
    c = constraint_adapter.validate_python({"id": "x", "type": ctype, "strength": "hard", "params": params})
    return "x" not in check(cat, [s.id for s in cat.sections], [c]).violations


def day_meetings(cat: Catalog, day: str) -> list[tuple[int, int]]:
    return sorted((hm(m.start), hm(m.end)) for s in cat.sections for m in s.meetings if m.day == day)


# ---------------------------------------------------------------- 명세 참조 구현


def spec_lunch_ok(cat, days, w0, w1, need) -> bool:
    for d in days:
        free_start, best = w0, 0
        for s, e in day_meetings(cat, d):
            if e <= w0 or s >= w1:
                continue
            best = max(best, min(s, w1) - free_start)
            free_start = max(free_start, e)
        best = max(best, w1 - free_start)
        if best < need:
            return False
    return True


def spec_gap_ok(cat, days, max_minutes) -> bool:
    for d in days:
        ms = day_meetings(cat, d)
        gaps = [b[0] - a[1] for a, b in zip(ms, ms[1:])]
        if gaps and max(gaps) > max_minutes:
            return False
    return True


def spec_consecutive_ok(cat, days, max_minutes, reset=20) -> bool:
    for d in days:
        ms = day_meetings(cat, d)
        if not ms:
            continue
        chain_start, chain_end = ms[0]
        for s, e in ms[1:]:
            if s - chain_end >= reset:
                if chain_end - chain_start > max_minutes:
                    return False
                chain_start = s
            chain_end = max(chain_end, e)
        if chain_end - chain_start > max_minutes:
            return False
    return True


# ---------------------------------------------------------------- 반례


def test_lunch_total_free_minutes_vs_contiguous_block():
    """창 11:00-14:00, 최소 60분. 수업 11:30-12:15, 12:45-13:30 → 빈 시간 합 90분이지만 최장 연속 30분."""
    cat = catalog({"A": [("Mon", "11:30", "12:15")], "B": [("Mon", "12:45", "13:30")]})
    assert spec_lunch_ok(cat, ["Mon"], hm("11:00"), hm("14:00"), 60) is False  # 명세: 위반
    assert main_ok(cat, "lunch_free", {"start": "11:00", "end": "14:00", "min_free_minutes": 60}) is True  # main: 충족


def test_lunch_has_no_days_parameter():
    """명세는 지정일만 검사. main LunchFreeParams에는 days가 없어 '월요일만 점심 확보'를 표현할 수 없다."""
    c = None
    try:
        c = constraint_adapter.validate_python(
            {"id": "x", "type": "lunch_free", "strength": "hard", "params": {"days": ["Mon"], "start": "11:00", "end": "14:00", "min_free_minutes": 60}}
        )
    except Exception:  # noqa: BLE001  extra 필드 거절
        pass
    assert c is None


def test_max_gap_sub_period_gap_is_invisible():
    """09:00-09:50, 10:30-11:45 → 실제 빈 시간 40분. max_gap 30분이면 명세 위반, main은 인접 '교시'라 충족."""
    cat = catalog({"A": [("Mon", "09:00", "09:50")], "B": [("Mon", "10:30", "11:45")]})
    assert spec_gap_ok(cat, ["Mon"], 30) is False
    assert main_ok(cat, "max_gap", {"minutes": 30}) is True


def test_max_consecutive_short_break_chain():
    """09:00-10:15, 10:30-11:45 (쉬는 시간 15분 < reset 20) → 체인 165분. 상한 150이면 명세 위반, main은 2교시=허용."""
    cat = catalog({"A": [("Mon", "09:00", "10:15")], "B": [("Mon", "10:30", "11:45")]})
    assert spec_consecutive_ok(cat, ["Mon"], 150) is False
    assert main_ok(cat, "max_consecutive", {"minutes": 150}) is True


def test_max_consecutive_single_long_class():
    """단일 09:00-12:00(180분), 상한 150 → 명세 위반(단일 긴 수업도 상한 초과 가능). main은 교시 2칸=허용."""
    cat = catalog({"A": [("Mon", "09:00", "12:00")]})
    assert spec_consecutive_ok(cat, ["Mon"], 150) is False
    assert main_ok(cat, "max_consecutive", {"minutes": 150}) is True


def test_max_consecutive_exactly_reset_break_breaks_chain():
    """쉬는 시간 정확히 20분이면 명세는 체인을 끊는다: 09:00-10:15, 10:35-11:50, 상한 100 → 각 75분이라 충족.
    main은 쉬는 시간 개념 없이 연속 교시 2칸(100//75=1 초과) → 위반."""
    cat = catalog({"A": [("Mon", "09:00", "10:15")], "B": [("Mon", "10:35", "11:50")]})
    assert spec_consecutive_ok(cat, ["Mon"], 100) is True
    assert main_ok(cat, "max_consecutive", {"minutes": 100}) is False


def test_agreement_case_for_reference():
    """일치 사례(반례가 아님을 보이기 위한 대조): 09:00-10:15, 12:00-13:15, 공강 105분, max_gap 120 → 둘 다 충족."""
    cat = catalog({"A": [("Mon", "09:00", "10:15")], "B": [("Mon", "12:00", "13:15")]})
    assert spec_gap_ok(cat, ["Mon"], 120) is True
    assert main_ok(cat, "max_gap", {"minutes": 120}) is True
