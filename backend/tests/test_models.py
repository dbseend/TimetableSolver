import pytest
from pydantic import ValidationError

from app.domain.models import Catalog, Course, Meeting, Section


def course(cid="C1", **kw):
    return Course(id=cid, name="과목", credit=3, category="전선", **kw)


def section(sid="C1-01", cid="C1", **kw):
    return Section(
        id=sid, course_id=cid, meetings=[Meeting(day="Mon", start="09:00", end="10:15")], **kw
    )


def test_valid_catalog():
    cat = Catalog(courses=[course()], sections=[section()])
    assert cat.sections[0].meetings[0].day == "Mon"


def test_meeting_requires_start_before_end():
    with pytest.raises(ValidationError):
        Meeting(day="Mon", start="10:00", end="09:00")


@pytest.mark.parametrize("day", ["Sat", "mon", ""])
def test_meeting_rejects_bad_day(day):
    with pytest.raises(ValidationError):
        Meeting(day=day, start="09:00", end="10:00")


@pytest.mark.parametrize("t", ["9:00", "25:00", "09:60"])
def test_meeting_rejects_bad_time(t):
    with pytest.raises(ValidationError):
        Meeting(day="Mon", start=t, end="12:00")


def test_duplicate_course_ids_rejected():
    with pytest.raises(ValidationError):
        Catalog(courses=[course(), course()], sections=[])


def test_duplicate_section_ids_rejected():
    with pytest.raises(ValidationError):
        Catalog(courses=[course()], sections=[section(), section()])


def test_section_with_unknown_course_rejected():
    with pytest.raises(ValidationError):
        Catalog(courses=[course("C1")], sections=[section(cid="C2")])


def test_section_without_meetings_is_allowed():
    s = Section(id="C1-01", course_id="C1")
    assert s.meetings == []
