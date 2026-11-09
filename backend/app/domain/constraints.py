"""Closed constraint vocabulary (single source of truth).

The LLM may only produce JSON that validates against `Constraint`. The same schema drives the
OpenAPI contract, the TypeScript types, and the solver. `extra="forbid"` everywhere so that
unknown fields from an LLM are rejected instead of silently ignored.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, field_validator, model_validator

from app.core.time_slots import DAYS, Day, parse_hhmm

HHMM = Annotated[str, Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _Base(_Strict):
    id: str = Field(min_length=1)
    strength: Literal["hard", "soft"]
    weight: int = Field(default=5, ge=1, le=10)
    source_text: str | None = None


# ---- params building blocks -------------------------------------------------------------


class _DaysParams(_Strict):
    days: list[Day] = Field(min_length=1)

    @field_validator("days")
    @classmethod
    def _unique_days(cls, v: list[Day]) -> list[Day]:
        if len(set(v)) != len(v):
            raise ValueError("days must be unique")
        return v


class _TimeRange(_Strict):
    start: HHMM
    end: HHMM

    @model_validator(mode="after")
    def _ordered(self) -> "_TimeRange":
        if parse_hhmm(self.start) >= parse_hhmm(self.end):
            raise ValueError("start must be before end")
        return self


# ---- params ----------------------------------------------------------------------------


class CreditRangeParams(_Strict):
    min: int = Field(ge=0, le=40)
    max: int = Field(ge=0, le=40)

    @model_validator(mode="after")
    def _ordered(self) -> "CreditRangeParams":
        if self.min > self.max:
            raise ValueError("min must be <= max")
        return self


class CourseRefParams(_Strict):
    course_id: str = Field(min_length=1)


class TimeWindowParams(_DaysParams, _TimeRange):
    pass


class MinutesParams(_Strict):
    minutes: int = Field(ge=0, le=24 * 60)


class LunchFreeParams(_TimeRange):
    min_free_minutes: int = Field(ge=1, le=24 * 60)

    @model_validator(mode="after")
    def _fits_window(self) -> "LunchFreeParams":
        if self.min_free_minutes > parse_hhmm(self.end) - parse_hhmm(self.start):
            raise ValueError("min_free_minutes exceeds the window length")
        return self


class MaxDaysParams(_Strict):
    max_days: int = Field(ge=0, le=len(DAYS))


class CategoryMinParams(_Strict):
    category: str = Field(min_length=1)
    credits: int = Field(ge=0, le=40)


class InstructorParams(_Strict):
    instructor: str = Field(min_length=1)


# ---- the 13 constraint types -----------------------------------------------------------


class CreditRange(_Base):
    type: Literal["credit_range"]
    params: CreditRangeParams


class MustInclude(_Base):
    type: Literal["must_include"]
    params: CourseRefParams


class MustExclude(_Base):
    type: Literal["must_exclude"]
    params: CourseRefParams


class DayOff(_Base):
    type: Literal["day_off"]
    params: _DaysParams


class TimeAvoid(_Base):
    type: Literal["time_avoid"]
    params: TimeWindowParams


class TimePrefer(_Base):
    type: Literal["time_prefer"]
    params: TimeWindowParams


class MaxGap(_Base):
    type: Literal["max_gap"]
    params: MinutesParams


class LunchFree(_Base):
    type: Literal["lunch_free"]
    params: LunchFreeParams


class MaxConsecutive(_Base):
    type: Literal["max_consecutive"]
    params: MinutesParams


class MaxDaysOnCampus(_Base):
    type: Literal["max_days_on_campus"]
    params: MaxDaysParams


class CategoryMin(_Base):
    type: Literal["category_min"]
    params: CategoryMinParams


class InstructorAvoid(_Base):
    type: Literal["instructor_avoid"]
    params: InstructorParams


class InstructorPrefer(_Base):
    type: Literal["instructor_prefer"]
    params: InstructorParams


Constraint = Annotated[
    CreditRange
    | MustInclude
    | MustExclude
    | DayOff
    | TimeAvoid
    | TimePrefer
    | MaxGap
    | LunchFree
    | MaxConsecutive
    | MaxDaysOnCampus
    | CategoryMin
    | InstructorAvoid
    | InstructorPrefer,
    Field(discriminator="type"),
]

CONSTRAINT_TYPES: tuple[str, ...] = (
    "credit_range",
    "must_include",
    "must_exclude",
    "day_off",
    "time_avoid",
    "time_prefer",
    "max_gap",
    "lunch_free",
    "max_consecutive",
    "max_days_on_campus",
    "category_min",
    "instructor_avoid",
    "instructor_prefer",
)

constraint_adapter: TypeAdapter = TypeAdapter(Constraint)
constraints_adapter: TypeAdapter = TypeAdapter(list[Constraint])


def constraint_json_schema() -> dict:
    """JSON Schema handed to the LLM's structured output."""
    return constraints_adapter.json_schema()
