from typing import Annotated

from pydantic import BaseModel, Field, model_validator

from app.core.time_slots import Day, parse_hhmm

HHMM = Annotated[str, Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")]


class Meeting(BaseModel):
    day: Day
    start: HHMM
    end: HHMM

    @model_validator(mode="after")
    def _start_before_end(self) -> "Meeting":
        if parse_hhmm(self.start) >= parse_hhmm(self.end):
            raise ValueError("meeting start must be before end")
        return self


class Course(BaseModel):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    credit: float = Field(ge=0, le=10, multiple_of=0.5)  # 0.5 steps exist (e.g. 0.5-credit 교필)
    category: str = Field(min_length=1)
    prerequisites: list[str] = Field(default_factory=list)


class Section(BaseModel):
    id: str = Field(min_length=1)
    course_id: str = Field(min_length=1)
    meetings: list[Meeting] = Field(default_factory=list)
    instructor: str | None = None
    capacity: int | None = Field(default=None, ge=0)
    # Per-section overrides for courses whose sections differ (e.g. internships with variable
    # credits, a course that is 전필 for one section and 전선 for another). None = course value.
    credit: float | None = Field(default=None, ge=0, le=10, multiple_of=0.5)
    category: str | None = Field(default=None, min_length=1)


class Profile(BaseModel):
    """Student's completed/in-progress courses. Grades are intentionally not modelled."""

    taken: list[str] = Field(default_factory=list)
    in_progress: list[str] = Field(default_factory=list)


class Catalog(BaseModel):
    courses: list[Course]
    sections: list[Section]

    @model_validator(mode="after")
    def _referential_integrity(self) -> "Catalog":
        course_ids = [c.id for c in self.courses]
        if len(set(course_ids)) != len(course_ids):
            raise ValueError("duplicate course id")
        section_ids = [s.id for s in self.sections]
        if len(set(section_ids)) != len(section_ids):
            raise ValueError("duplicate section id")
        known = set(course_ids)
        if any(s.course_id not in known for s in self.sections):
            raise ValueError("section references an unknown course")
        return self

    def credit_and_category(self, section: Section) -> tuple[float, str]:
        """Effective values for a section: its override, else its course's."""
        course = next(c for c in self.courses if c.id == section.course_id)
        return (
            course.credit if section.credit is None else section.credit,
            section.category or course.category,
        )
