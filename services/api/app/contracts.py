"""API/도메인 계약 (Pydantic v2). 이 파일이 계약의 원본이며 OpenAPI → TS 타입을 생성한다.

규칙(docs/02-architecture.md §4):
- 시간은 자정 기준 정수 분, 구간은 [start, end).
- 학점은 credit_units = 학점 × 100 (정수).
- 추가 필드 거절, 암묵적 타입 변환 금지(strict).
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, model_validator

SCHEMA_VERSION = "1.0"

Day = Literal["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
DAYS: tuple[str, ...] = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")

Minute = Annotated[StrictInt, Field(ge=0, le=1440)]
Id = Annotated[str, Field(min_length=1, max_length=128)]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


# ---------------------------------------------------------------- catalog


class Meeting(Strict):
    day: Day
    start_minute: Minute
    end_minute: Minute
    room: str | None = None
    campus_required: StrictBool

    @model_validator(mode="after")
    def _interval(self) -> Meeting:
        if not self.start_minute < self.end_minute:
            raise ValueError("start_minute must be < end_minute ([start,end), same day)")
        return self


class Course(Strict):
    id: Id
    name: str = Field(min_length=1, max_length=200)
    credit_units: Annotated[StrictInt, Field(ge=0, le=3000)]
    category_ids: list[Id] = Field(default_factory=list)
    equivalence_group_id: Id | None = None


class Instructor(Strict):
    id: Id
    name: str = Field(min_length=1, max_length=100)


class Section(Strict):
    id: Id
    course_id: Id
    section_label: str = Field(min_length=1, max_length=32)
    instructor_ids: list[Id] = Field(default_factory=list)
    delivery_mode: Literal["in_person", "online_sync", "online_async"]
    meetings: list[Meeting] = Field(default_factory=list, max_length=10)
    support_status: Literal["supported", "unsupported"] = "supported"
    issue_codes: list[str] = Field(default_factory=list)
    # 분반별 값(docs/decisions/0008). null이면 Course 값을 상속한다. 같은 과목의 분반마다 학점·이수구분이 다른 경우에만 채운다.
    credit_units: Annotated[StrictInt, Field(ge=0, le=3000)] | None = None
    category_ids: list[Id] | None = None


class Catalog(Strict):
    schema_version: Literal["1.0"] = "1.0"
    catalog_id: Id
    term_id: Id
    timezone: Literal["Asia/Seoul"] = "Asia/Seoul"
    data_origin: Literal["synthetic", "user_import"] = "synthetic"
    category_groups: dict[str, list[Id]] = Field(default_factory=dict)
    courses: list[Course] = Field(max_length=2000)
    instructors: list[Instructor] = Field(default_factory=list)
    sections: list[Section] = Field(max_length=1000)


# ---------------------------------------------------------------- constraints (P0)


class CreditRangeParams(Strict):
    min_units: Annotated[StrictInt, Field(ge=0, le=6000)]
    max_units: Annotated[StrictInt, Field(ge=0, le=6000)]

    @model_validator(mode="after")
    def _order(self) -> CreditRangeParams:
        if self.min_units > self.max_units:
            raise ValueError("min_units must be <= max_units")
        return self


class MustIncludeParams(Strict):
    course_id: Id
    allowed_section_ids: list[Id] | None = None

    @model_validator(mode="after")
    def _non_empty(self) -> MustIncludeParams:
        if self.allowed_section_ids is not None and len(self.allowed_section_ids) == 0:
            raise ValueError("allowed_section_ids must be null or non-empty")
        return self


class MustExcludeParams(Strict):
    course_id: Id


class DayOffParams(Strict):
    days: list[Day] = Field(min_length=1, max_length=7)


class TimeAvoidParams(Strict):
    days: list[Day] = Field(min_length=1, max_length=7)
    start_minute: Minute
    end_minute: Minute

    @model_validator(mode="after")
    def _interval(self) -> TimeAvoidParams:
        if not self.start_minute < self.end_minute:
            raise ValueError("start_minute must be < end_minute")
        return self


class CategoryMinParams(Strict):
    category_ids: list[Id] = Field(min_length=1)
    min_units: Annotated[StrictInt, Field(ge=1, le=6000)]


class InstructorAvoidParams(Strict):
    instructor_ids: list[Id] = Field(min_length=1)


class MaxDaysParams(Strict):
    max_days: Annotated[StrictInt, Field(ge=0, le=7)]


class _ConstraintBase(Strict):
    id: Id
    strength: Literal["hard", "soft"]
    weight: Annotated[StrictInt, Field(ge=1, le=10)] | None = None

    @model_validator(mode="after")
    def _weight(self) -> Any:
        if self.strength == "hard" and self.weight is not None:
            raise ValueError("hard constraints must have weight=null")
        if self.strength == "soft" and self.weight is None:
            raise ValueError("soft constraints require integer weight 1..10")
        return self


class CreditRange(_ConstraintBase):
    type: Literal["credit_range"]
    params: CreditRangeParams


class MustInclude(_ConstraintBase):
    type: Literal["must_include"]
    params: MustIncludeParams


class MustExclude(_ConstraintBase):
    type: Literal["must_exclude"]
    params: MustExcludeParams


class DayOff(_ConstraintBase):
    type: Literal["day_off"]
    params: DayOffParams


class TimeAvoid(_ConstraintBase):
    type: Literal["time_avoid"]
    params: TimeAvoidParams


class CategoryMin(_ConstraintBase):
    type: Literal["category_min"]
    params: CategoryMinParams


class InstructorAvoid(_ConstraintBase):
    type: Literal["instructor_avoid"]
    params: InstructorAvoidParams


class MaxDaysOnCampus(_ConstraintBase):
    type: Literal["max_days_on_campus"]
    params: MaxDaysParams


Constraint = Annotated[
    CreditRange | MustInclude | MustExclude | DayOff | TimeAvoid | CategoryMin | InstructorAvoid | MaxDaysOnCampus,
    Field(discriminator="type"),
]

SUPPORTED_CONSTRAINT_TYPES: tuple[str, ...] = (
    "credit_range",
    "must_include",
    "must_exclude",
    "day_off",
    "time_avoid",
    "category_min",
    "instructor_avoid",
    "max_days_on_campus",
)
# 명세에 있으나 이번 MVP에서 구현하지 않은 type: API가 UNSUPPORTED_CONSTRAINT로 응답한다.
UNSUPPORTED_CONSTRAINT_TYPES: tuple[str, ...] = (
    "lunch_free",
    "max_gap",
    "max_consecutive",
    "time_prefer",
    "instructor_prefer",
)


# ---------------------------------------------------------------- solve


class Confirmation(Strict):
    input_revision: Annotated[StrictInt, Field(ge=0)]
    confirmed_revision: Annotated[StrictInt, Field(ge=0)]


class SolveOptions(Strict):
    max_candidates: Annotated[StrictInt, Field(ge=1, le=5)] = 3
    min_section_distance: Annotated[StrictInt, Field(ge=1, le=20)] = 2
    time_budget_ms: Annotated[StrictInt, Field(ge=100, le=8000)] = 3000


class SolveRequest(Strict):
    schema_version: Literal["1.0"] = "1.0"
    catalog: Catalog
    catalog_revision: str = Field(min_length=64, max_length=64)
    allowed_section_ids: list[Id] = Field(max_length=1000)
    constraints: list[Constraint] = Field(max_length=50)
    confirmation: Confirmation
    options: SolveOptions = Field(default_factory=SolveOptions)


class ConstraintEvaluation(Strict):
    constraint_id: str
    type: str
    strength: Literal["hard", "soft"]
    weight: int | None
    satisfied: bool
    violation: int
    unit: str
    evidence: list[str]


class Fact(Strict):
    fact_id: str
    type: str
    payload: dict[str, Any]


class Candidate(Strict):
    id: str
    selected_section_ids: list[str]
    search_status: Literal["optimal", "feasible"]
    optimality_proven: bool
    objective_penalty: int
    original_soft_score: float | None
    total_credit_units: int
    constraint_evaluations: list[ConstraintEvaluation]
    facts: list[Fact]
    hard_validation: Literal["passed"]


class SearchInfo(Strict):
    requested_count: int
    returned_count: int
    termination_reason: Literal["requested_count", "exhausted_under_diversity", "time_limit", "not_started"]
    min_section_distance: int


class Timing(Strict):
    validation_ms: float
    model_build_ms: float
    first_candidate_ms: float | None
    solve_ms: float
    total_ms: float
    process_ms: float | None = None


class SolveResponse(Strict):
    schema_version: Literal["1.0"] = "1.0"
    request_id: str
    input_revision: int
    catalog_revision: str
    request_hash: str
    status: Literal["optimal", "feasible", "infeasible", "unknown"]
    candidates: list[Candidate]
    search: SearchInfo
    timing: Timing
    warnings: list[str]


# ---------------------------------------------------------------- diagnose


class DiagnoseRequest(SolveRequest):
    diagnosis_budget_ms: Annotated[StrictInt, Field(ge=200, le=10000)] = 5000


class ConstraintChange(Strict):
    constraint_id: str
    before: dict[str, Any]
    after: dict[str, Any]


class RelaxationProposal(Strict):
    proposal_id: str
    base_request_hash: str
    changes: list[ConstraintChange]
    changed_hard_count: int
    verified_candidate: Candidate
    original_soft_penalty: int | None
    original_soft_score: float | None
    changed_constraint_violations: list[ConstraintEvaluation]
    objective_delta: None = None
    verification_status: Literal["passed"]


class DiagnosisResponse(Strict):
    schema_version: Literal["1.0"] = "1.0"
    request_id: str
    request_hash: str
    input_revision: int
    status: Literal["diagnosed", "partial", "unknown", "not_infeasible"]
    core_constraint_ids: list[str]
    core_is_minimal: Literal[False] = False
    background_infeasible: bool | None
    proposals: list[RelaxationProposal]
    attempted_changes_count: int
    search_complete_within_declared_scope: bool
    termination_reason: str
    scope_note: str


# ---------------------------------------------------------------- catalog validate


class CatalogValidateRequest(Strict):
    catalog: Catalog


class RowIssue(Strict):
    path: str
    code: str
    message: str


class CatalogValidateResponse(Strict):
    request_id: str
    valid: bool
    catalog_revision: str | None
    catalog: Catalog | None
    errors: list[RowIssue]
    warnings: list[RowIssue]
    stats: dict[str, int]


# ---------------------------------------------------------------- default school catalogs


class DefaultCatalogSummary(Strict):
    """관리자가 변환해 둔 기본 학교 카탈로그 요약(서버가 읽을 때 다시 검증)."""

    id: str
    term_id: str
    label: str
    as_of: str | None  # 데이터 기준일(YYYY-MM-DD). 모르면 null → 화면에 '기준일 미확인'
    source_file: str | None
    generated_at: str | None
    period_table_basis: str | None
    valid: bool
    error: str | None
    stats: dict[str, int]
    exclusion_reasons: dict[str, int]
    excluded_courses: int


class DefaultCatalogList(Strict):
    catalogs: list[DefaultCatalogSummary]


class DefaultCatalogResponse(Strict):
    summary: DefaultCatalogSummary
    catalog: Catalog
    catalog_revision: str
    course_orgs: dict[str, str]
    major_type_categories: list[str]
    import_issues: list[dict[str, Any]]


# ---------------------------------------------------------------- parse (NL)


class EntityCourse(Strict):
    id: Id
    name: str = Field(max_length=200)
    category_ids: list[Id] = Field(default_factory=list)
    section_ids: list[Id] = Field(default_factory=list)


class EntityInstructor(Strict):
    id: Id
    name: str = Field(max_length=100)
    course_ids: list[Id] = Field(default_factory=list)
    section_ids: list[Id] = Field(default_factory=list)


class ParseEntities(Strict):
    courses: list[EntityCourse] = Field(max_length=2000)
    instructors: list[EntityInstructor] = Field(max_length=2000)
    category_groups: dict[str, list[Id]] = Field(default_factory=dict)
    category_ids: list[Id] = Field(default_factory=list)


class ExistingConstraintRef(Strict):
    id: Id
    type: str
    label: str = Field(max_length=200)


class ParseRequest(Strict):
    schema_version: Literal["1.0"] = "1.0"
    text: str = Field(min_length=1, max_length=2000)
    catalog_revision: str = Field(min_length=64, max_length=64)
    input_revision: Annotated[StrictInt, Field(ge=0)]
    entities: ParseEntities
    existing_constraints: list[ExistingConstraintRef] = Field(default_factory=list, max_length=50)


class QuestionOption(Strict):
    id: str
    label: str
    patch: dict[str, Any] | None = None  # 선택 시 draft에 적용할 변경


class Question(Strict):
    id: str
    draft_id: str | None
    field: str
    message: str
    options: list[QuestionOption]


class DraftConstraint(Strict):
    """확정 전 초안. params의 일부가 null(미해결)일 수 있다."""

    draft_id: str
    type: str
    strength: Literal["hard", "soft"] | None
    weight: int | None
    params: dict[str, Any]
    source_text: str
    unresolved_fields: list[str]
    action: Literal["add", "delete"] = "add"
    target_constraint_id: str | None = None


class UnsupportedRequest(Strict):
    source_text: str
    reason_code: str
    message: str


class ParseResponse(Strict):
    schema_version: Literal["1.0"] = "1.0"
    request_id: str
    catalog_revision: str
    input_revision: int
    status: Literal["parsed", "needs_clarification"]
    draft_constraints: list[DraftConstraint]
    questions: list[Question]
    unsupported_requests: list[UnsupportedRequest]
    warnings: list[str]
    provider_mode: Literal["live", "fixture"]


# ---------------------------------------------------------------- errors / capabilities


class ErrorField(Strict):
    path: str
    reason: str


class ErrorBody(Strict):
    code: str
    message: str
    request_id: str
    fields: list[ErrorField] = Field(default_factory=list)


class ErrorResponse(Strict):
    error: ErrorBody


class Capabilities(Strict):
    schema_version: Literal["1.0"] = "1.0"
    supported_constraint_types: list[str]
    unsupported_constraint_types: list[str]
    parse_provider_mode: Literal["live", "fixture", "unavailable"]
    live_llm_configured: bool
    features: dict[str, Literal["implemented", "not_implemented"]]
    limits: dict[str, int]
