"""Request/response models: the API contract (see docs/API.md)."""

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.domain.constraints import Constraint
from app.domain.models import Catalog, Profile

# ---- errors ----------------------------------------------------------------------------


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: list[dict] | None = None


class ErrorResponse(BaseModel):
    error: ErrorDetail


# ---- /health ---------------------------------------------------------------------------


class HealthResponse(BaseModel):
    status: Literal["ok"]
    version: str


# ---- /catalog/validate -----------------------------------------------------------------


class CatalogValidateRequest(BaseModel):
    """Lenient on purpose: rows are validated one by one and reported, not rejected wholesale."""

    courses: list[dict]
    sections: list[dict]


class RowError(BaseModel):
    kind: Literal["course", "section"]
    index: int = Field(ge=0)
    message: str


class CatalogValidateResponse(BaseModel):
    catalog: Catalog | None
    errors: list[RowError]


# ---- /profile/parse (LLM fallback only) --------------------------------------------------


class ProfileRow(BaseModel):
    """Minimal columns only. Grades, student id and name must be stripped client-side."""

    code: str | None = None
    name: str = Field(min_length=1)
    credit: float | None = Field(default=None, ge=0, le=10, multiple_of=0.5)


class ProfileParseRequest(BaseModel):
    consent: Literal[True]
    rows: list[ProfileRow]


class ProfileParseResponse(BaseModel):
    taken: list[str]
    unmatched: list[str]


# ---- /constraints/parse ----------------------------------------------------------------


class CourseRef(BaseModel):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)


class CatalogSummary(BaseModel):
    """What the parser needs to resolve names. Only `categories` is shown to the LLM; courses and
    instructors are matched on the server."""

    courses: list[CourseRef] = Field(default_factory=list)
    instructors: list[str] = Field(default_factory=list)
    categories: list[str] = Field(default_factory=list)


class ConstraintsParseRequest(BaseModel):
    text: str = Field(min_length=1)
    catalog_summary: CatalogSummary | None = None


class Ambiguity(BaseModel):
    constraint_id: str | None = None
    message: str
    default_interpretation: str | None = None


class EntityMatch(BaseModel):
    id: str
    name: str
    score: float = Field(ge=0, le=1)


class EntityCandidate(BaseModel):
    mention: str
    kind: Literal["course", "instructor"]
    candidates: list[EntityMatch]


class ConstraintsParseResponse(BaseModel):
    constraints: list[Constraint]
    ambiguities: list[Ambiguity] = Field(default_factory=list)
    entity_candidates: list[EntityCandidate] = Field(default_factory=list)


# ---- /solve ----------------------------------------------------------------------------


class PoolItem(BaseModel):
    """A course the student wants to consider. Higher priority is preferred when not all fit."""

    course_id: str = Field(min_length=1)
    priority: int = Field(default=3, ge=1, le=5)


class SolveRequest(BaseModel):
    """The solver picks courses only from `pool` (plus must_include targets), never the whole
    catalog: without a pool it fills credits with arbitrary 0/1-credit courses."""

    catalog: Catalog
    pool: list[PoolItem] = Field(min_length=1)
    profile: Profile = Field(default_factory=Profile)
    constraints: list[Constraint] = Field(default_factory=list)
    n: int = Field(default=3, ge=1, le=10)
    diversity_k: int = Field(default=1, ge=0)
    time_limit_s: float | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def _unique_ids(self) -> "SolveRequest":
        ids = [c.id for c in self.constraints]
        if len(set(ids)) != len(ids):
            raise ValueError("duplicate constraint id")
        pool = [p.course_id for p in self.pool]
        if len(set(pool)) != len(pool):
            raise ValueError("duplicate pool course id")
        # a must_include target missing from the catalog is a diagnosis, not a 422; pool is not
        if set(pool) - {c.id for c in self.catalog.courses}:
            raise ValueError("pool references an unknown course")
        return self


class Violation(BaseModel):
    id: str
    amount: int = Field(ge=0)


class Candidate(BaseModel):
    sections: list[str]
    objective: int
    satisfied: list[str]
    violated: list[Violation]


class Relaxation(BaseModel):
    drop: str
    feasible: bool
    objective_delta: int | None = Field(
        default=None,
        description="Best objective without `drop` minus the best objective with no hard user "
        "constraints at all (<= 0; 0 = dropping it costs nothing). None when still infeasible.",
    )


class Diagnosis(BaseModel):
    core: list[str]
    relaxations: list[Relaxation] = Field(default_factory=list)


class SolveStats(BaseModel):
    solve_ms: int = Field(ge=0)
    n_sections_after_filter: int = Field(ge=0)


class SolveResult(BaseModel):
    status: Literal["OPTIMAL", "FEASIBLE", "INFEASIBLE", "UNKNOWN"]
    candidates: list[Candidate] = Field(default_factory=list)
    diagnosis: Diagnosis | None = None
    stats: SolveStats


# ---- /explain --------------------------------------------------------------------------


class ExplainRequest(BaseModel):
    """The explainer needs names, so the catalog and constraints travel with the result."""

    catalog: Catalog
    constraints: list[Constraint] = Field(default_factory=list)
    result: SolveResult


class ExplainResponse(BaseModel):
    candidate_explanations: list[str]
    diagnosis_text: str | None = None
