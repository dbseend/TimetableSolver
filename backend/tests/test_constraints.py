import copy

import pytest
from pydantic import ValidationError

from app.domain.constraints import (
    CONSTRAINT_TYPES,
    constraint_adapter,
    constraint_json_schema,
    constraints_adapter,
)

# Appendix A of docs/PLAN.md
APPENDIX_A = [
    {
        "id": "c1",
        "type": "day_off",
        "params": {"days": ["Fri"]},
        "strength": "soft",
        "weight": 7,
        "source_text": "금요일엔 수업 없었으면 좋겠고",
    },
    {
        "id": "c2",
        "type": "time_avoid",
        "params": {
            "days": ["Mon", "Tue", "Wed", "Thu", "Fri"],
            "start": "09:00",
            "end": "10:00",
        },
        "strength": "hard",
        "weight": 10,
        "source_text": "아침 9시 수업은 절대 싫어",
    },
    {
        "id": "c3",
        "type": "category_min",
        "params": {"category": "전공", "credits": 12},
        "strength": "hard",
        "weight": 10,
        "source_text": "전공은 12학점 이상",
    },
    {
        "id": "c4",
        "type": "lunch_free",
        "params": {"start": "12:00", "end": "13:00", "min_free_minutes": 60},
        "strength": "hard",
        "weight": 10,
        "source_text": "점심은 꼭 비워줘",
    },
]

# One minimal valid example per type
EXAMPLES = {
    "credit_range": {"min": 12, "max": 18},
    "must_include": {"course_id": "CSE301"},
    "must_exclude": {"course_id": "CSE302"},
    "day_off": {"days": ["Fri"]},
    "time_avoid": {"days": ["Mon"], "start": "08:00", "end": "09:00"},
    "time_prefer": {"days": ["Tue", "Thu"], "start": "13:00", "end": "17:00"},
    "max_gap": {"minutes": 90},
    "lunch_free": {"start": "12:00", "end": "13:00", "min_free_minutes": 30},
    "max_consecutive": {"minutes": 180},
    "max_days_on_campus": {"max_days": 4},
    "category_min": {"category": "전필", "credits": 9},
    "instructor_avoid": {"instructor": "홍길동"},
    "instructor_prefer": {"instructor": "김철수"},
}


def make(type_: str, **over):
    base = {"id": "x", "type": type_, "strength": "soft", "params": copy.deepcopy(EXAMPLES[type_])}
    base.update(over)
    return base


def test_appendix_a_roundtrips():
    parsed = constraints_adapter.validate_python(APPENDIX_A)
    assert constraints_adapter.dump_python(parsed, mode="json") == APPENDIX_A


def test_there_are_exactly_13_types_and_examples_cover_all():
    assert len(CONSTRAINT_TYPES) == 13
    assert set(EXAMPLES) == set(CONSTRAINT_TYPES)


@pytest.mark.parametrize("type_", CONSTRAINT_TYPES)
def test_each_type_validates(type_):
    c = constraint_adapter.validate_python(make(type_))
    assert c.type == type_
    assert c.weight == 5  # default


def test_json_schema_has_discriminator_for_all_types():
    schema = constraint_json_schema()
    mapping = schema["items"]["discriminator"]["mapping"]
    assert set(mapping) == set(CONSTRAINT_TYPES)


def test_unknown_type_rejected():
    with pytest.raises(ValidationError):
        constraint_adapter.validate_python(make("day_off", type="teleport"))


def test_extra_fields_rejected_at_top_level_and_in_params():
    with pytest.raises(ValidationError):
        constraint_adapter.validate_python(make("day_off", surprise=1))
    bad = make("day_off")
    bad["params"]["surprise"] = 1
    with pytest.raises(ValidationError):
        constraint_adapter.validate_python(bad)


@pytest.mark.parametrize("w", [0, 11, -1])
def test_weight_out_of_range(w):
    with pytest.raises(ValidationError):
        constraint_adapter.validate_python(make("day_off", weight=w))


def test_strength_must_be_hard_or_soft():
    with pytest.raises(ValidationError):
        constraint_adapter.validate_python(make("day_off", strength="medium"))


def test_time_range_must_be_ordered():
    bad = make("time_avoid")
    bad["params"].update(start="10:00", end="09:00")
    with pytest.raises(ValidationError):
        constraint_adapter.validate_python(bad)


def test_credit_range_must_be_ordered():
    bad = make("credit_range")
    bad["params"].update(min=19, max=12)
    with pytest.raises(ValidationError):
        constraint_adapter.validate_python(bad)


def test_days_must_be_nonempty_unique_and_weekdays():
    for days in ([], ["Fri", "Fri"], ["Sun"]):
        bad = make("day_off")
        bad["params"]["days"] = days
        with pytest.raises(ValidationError):
            constraint_adapter.validate_python(bad)


def test_lunch_free_cannot_exceed_window():
    bad = make("lunch_free")
    bad["params"]["min_free_minutes"] = 90
    with pytest.raises(ValidationError):
        constraint_adapter.validate_python(bad)


def test_max_days_bounded_by_days():
    bad = make("max_days_on_campus")
    bad["params"]["max_days"] = 7
    with pytest.raises(ValidationError):
        constraint_adapter.validate_python(bad)
