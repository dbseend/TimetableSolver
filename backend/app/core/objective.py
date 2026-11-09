"""The objective shared by the solver and by anyone grading a timetable (eval, tests).

objective = sum(PRIORITY_SCALE * priority) over chosen pool courses
          - sum(weight * COST[type] * violation) over soft constraints,
with violations in the validator's units (app/validation/validator.py).
"""

from app.domain.api_models import PoolItem
from app.domain.constraints import Constraint
from app.domain.models import Catalog, Profile
from app.validation.validator import Report, check

PRIORITY_SCALE = 1000  # per priority point of a chosen pool course (priority 3 -> 3000)
# Penalty per unit of violation at weight 1, in the validator's units (see validator docstring).
# Calibrated so a weight-5 violation of a typical size costs about half a priority-3 course:
# one 75min class in an avoided window 5*4*75=1500, one class day on a day off 5*300=1500.
COST = {
    "credit_range": 100,  # per half-credit
    "category_min": 100,  # per half-credit
    "must_include": 600,
    "must_exclude": 600,
    "day_off": 300,  # per day
    "time_avoid": 4,  # per minute
    "time_prefer": 4,  # per minute
    "max_gap": 200,  # per period over
    "max_consecutive": 200,  # per period over
    "lunch_free": 300,  # per day
    "max_days_on_campus": 300,  # per day over
    "instructor_avoid": 300,  # per section
    "instructor_prefer": 300,
}


def penalty(constraint: Constraint, amount: int) -> int:
    return constraint.weight * COST[constraint.type] * amount


def score(
    catalog: Catalog,
    pool: list[PoolItem],
    constraints: list[Constraint],
    section_ids: list[str],
    profile: Profile | None = None,
) -> tuple[Report, int]:
    """Validator report and objective value of any timetable (feasible or not)."""
    report = check(catalog, section_ids, constraints, [p.course_id for p in pool], profile)
    priority = {p.course_id: p.priority for p in pool}
    sections = {s.id: s for s in catalog.sections}
    courses = {sections[sid].course_id for sid in section_ids if sid in sections}
    reward = sum(PRIORITY_SCALE * priority.get(c, 3) for c in courses)
    soft = sum(
        penalty(c, report.violations.get(c.id, 0)) for c in constraints if c.strength == "soft"
    )
    return report, reward - soft
