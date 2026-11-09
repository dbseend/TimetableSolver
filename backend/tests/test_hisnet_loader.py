"""HISNet paste adapter. Fixtures are fictional (SYN codes, 가상교수) — never real rows."""

import pytest

from app.loaders.hisnet import parse, parse_export, parse_time

HEADER = "구분\t과목코드\t분반\t과목명\t학점\t교수\t시간\t강의실\t정원\t인원\t영어"


def row(*cells: str) -> str:
    return "\t".join(cells)


def test_parse_time_merges_consecutive_periods():
    assert parse_time("Mon1,Thu1,Thu2") == [
        {"day": "Mon", "start": "09:00", "end": "10:15"},
        {"day": "Thu", "start": "09:00", "end": "11:45"},
    ]
    assert parse_time("Tue6, Tue7") == [{"day": "Tue", "start": "16:30", "end": "19:15"}]
    assert parse_time("Wed3,Wed5") == [
        {"day": "Wed", "start": "12:00", "end": "13:15"},
        {"day": "Wed", "start": "15:00", "end": "16:15"},
    ]
    assert parse_time("") == []


def test_class_length_depends_on_credit():
    assert parse_time("Mon1", 3) == [{"day": "Mon", "start": "09:00", "end": "10:15"}]
    assert parse_time("Mon1", 2) == [{"day": "Mon", "start": "09:00", "end": "09:50"}]
    assert parse_time("Mon1,Mon2", 2) == [{"day": "Mon", "start": "09:00", "end": "11:20"}]


@pytest.mark.parametrize("bad", ["Mon0", "Monday1", "1Mon"])
def test_parse_time_rejects_bad_tokens(bad):
    with pytest.raises(ValueError):
        parse_time(bad)


def test_parse_groups_sections_by_course():
    text = "\n".join(
        [
            "개설시간표조회 (※ 안내문)",
            HEADER,
            row("전선", "SYN10001", "01", "가상 알파", "3", "가상교수 A", "Mon1,Thu1", "R1", "30"),
            row("전선", "SYN10001", "02", "가상 알파", "3", "가상교수 B", "Mon2,Thu2", "R1", ""),
            row("교필", "SYN20002", "01", "가상과목 베타", "1", "", "Tue6,Tue7", "R2", "40"),
        ]
    )
    catalog, errors = parse(text)
    assert errors == []
    assert [c.id for c in catalog.courses] == ["SYN10001", "SYN20002"]
    assert catalog.courses[1].category == "교필"
    s = {x.id: x for x in catalog.sections}
    assert s["SYN10001-01"].capacity == 30 and s["SYN10001-02"].capacity is None
    assert s["SYN20002-01"].instructor is None
    assert s["SYN10001-02"].meetings[0].start == "10:30"


def test_parse_reports_bad_rows_without_echoing_them():
    text = "\n".join(
        [
            HEADER,
            row("전선", "SYN1", "01", "가상과목", "0.5", "가상교수 비밀", "Mon1"),
            row("전선", "SYN2", "01", "가상과목", "3", "가상교수 비밀", "Sat1"),
            row("전선", "SYN3", "01", "가상과목", "3", "", "Mon1"),
            row("전선", "SYN3", "02", "다른이름", "3", "", "Mon2"),
        ]
    )
    catalog, errors = parse(text)
    assert [e.index for e in errors] == [0, 1, 3]
    assert all("비밀" not in e.message for e in errors)
    assert [c.id for c in catalog.courses] == ["SYN3"]


def test_parse_requires_header():
    assert parse("no header here")[0] is None
    assert "missing columns" in parse("과목코드\t분반")[1][0].message


def test_parse_time_prefers_korean_half_of_export_cells():
    assert parse_time("수4,수5,수6 Wed4,Wed5,ed6") == [
        {"day": "Wed", "start": "13:30", "end": "17:45"}
    ]
    assert parse_time("월10,목10 Mon10목1")[0] == {"day": "Mon", "start": "22:30", "end": "23:45"}


EXPORT_HTML = """<html><head><title>x</title></head><body>
Warning: something
<table><tr><td>구 분</td><td>과목코드</td><td>분 반</td><td>과목명 (CourseName)</td><td>학점</td>
<td>개설정보</td><td>시간 (Period)</td><td>정원</td></tr>
<tr><td>전선</td><td>SYN10001</td><td>01</td><td>가상 알파(Alpha)</td><td>3</td>
<td>가상학부 주간가상교수A외 3명</td><td>월1,목1 Mon1,Thu1</td><td>40</td></tr>
<tr><td>교필</td><td>SYN20002</td><td>01</td><td>가상 베타</td><td>1</td>
<td>GLS 주간Virtual Prof B</td><td></td><td>300</td></tr>
</table></body></html>"""


def test_parse_export_html_cp949():
    catalog, errors = parse_export(EXPORT_HTML.encode("cp949"))
    assert errors == []
    s = {x.id: x for x in catalog.sections}
    assert s["SYN10001-01"].instructor == "가상교수A"
    assert s["SYN20002-01"].instructor == "Virtual Prof B"
    assert s["SYN20002-01"].meetings == []  # online / intensive courses have no time
    assert catalog.courses[0].name == "가상 알파(Alpha)"
