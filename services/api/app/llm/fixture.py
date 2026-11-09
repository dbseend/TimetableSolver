"""데모 해석기(fixture 모드): LLM이 아닌 결정적 규칙 기반 파서.

- 등록된 문형만 해석한다. 해석하지 못한 절은 unsupported로 그대로 드러낸다(가짜 정답 금지).
- 강도 정책(docs/02 §5.2): 해당 절의 '가능하면/되도록/좋겠' → soft,
  '반드시/무조건/절대/필수/꼭' 또는 수치 하한·상한 → hard, 그 밖은 soft. 상반 단서 → 질문.
- 사용자 문장·카탈로그 문자열은 데이터로만 비교한다. 실행하지 않는다.
"""

from __future__ import annotations

import re

from app.contracts import ParseRequest
from app.llm.base import ProviderOutput

DAY_MAP = {"월": "Mon", "화": "Tue", "수": "Wed", "목": "Thu", "금": "Fri", "토": "Sat", "일": "Sun"}
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"]
SOFT_HINT = re.compile(r"가능하면|되도록|웬만하면|좋겠|면 좋|할 수 있으면")
HARD_CUE = re.compile(r"반드시|무조건|절대|필수|꼭|무슨 일이 있어도")
NEG = re.compile(r"싫|빼|제외|피하|피해|없었으면|안 ?듣|안 ?들|말아|말고|빼줘")
POS_COURSE = re.compile(r"필수|꼭|들을|듣고|들어|넣어|포함|수강")

UNSUPPORTED_RULES: list[tuple[re.Pattern, str, str]] = [
    (
        re.compile(r"python|파이썬|코드|sql|스크립트|실행|규칙.{0,4}무시|시스템 ?프롬프트", re.I),
        "INSTRUCTION_NOT_EXECUTED",
        "명령·코드 실행 요청은 처리하지 않습니다. 시간표 조건만 해석합니다.",
    ),
    (re.compile(r"팀플|팀 ?프로젝트|조별"), "ATTRIBUTE_UNAVAILABLE", "팀플 여부는 카탈로그에 없는 속성이라 지원하지 않습니다."),
    (re.compile(r"강의평|평점|별점|꿀강|학점 ?잘|성적 ?잘"), "ATTRIBUTE_UNAVAILABLE", "강의평·성적 관련 조건은 지원하지 않습니다."),
    (re.compile(r"점심"), "P1_NOT_IMPLEMENTED", "점심시간 확보(lunch_free)는 이번 MVP에서 구현하지 않았습니다."),
    (re.compile(r"연강|연속 ?수업"), "P1_NOT_IMPLEMENTED", "연강 제한(max_consecutive)은 이번 MVP에서 구현하지 않았습니다."),
    (re.compile(r"우주 ?공강|공강 ?시간|공강이 ?길|빈 ?시간"), "P1_NOT_IMPLEMENTED", "최장 공강(max_gap)은 이번 MVP에서 구현하지 않았습니다."),
    (re.compile(r"시험|과제|출석|좌석|정원|여석"), "ATTRIBUTE_UNAVAILABLE", "시험·과제·좌석 정보는 지원하지 않습니다."),
]


def split_clauses(text: str) -> list[str]:
    parts = re.split(r"[,.\n;!?]|그리고|그리고요|또한", text)
    return [p.strip() for p in parts if p and p.strip()]


def norm(s: str) -> str:
    return re.sub(r"\s+", "", s).lower()


class StrengthConflict(Exception):
    pass


def strength_of(clause: str, numeric_bound: bool = False) -> str:
    soft = bool(SOFT_HINT.search(clause))
    hard = bool(HARD_CUE.search(clause))
    if soft and hard:
        raise StrengthConflict()
    if soft:
        return "soft"
    if hard or numeric_bound:
        return "hard"
    return "soft"


def find_days(clause: str) -> list[str]:
    days: list[str] = []
    for m in re.finditer(r"([월화수목금토일])(?=\s*요일|\s*[·,/]\s*[월화수목금토일]\s*요일|\s*(?:와|과|랑|하고)\s*[월화수목금토일]\s*요일)", clause):
        d = DAY_MAP[m.group(1)]
        if d not in days:
            days.append(d)
    return days


class FixtureProvider:
    mode = "fixture"

    def parse(self, req: ParseRequest) -> ProviderOutput:
        out = ProviderOutput()
        self._n = 0
        self._q = 0
        for clause in split_clauses(req.text):
            try:
                self._clause(clause, req, out)
            except StrengthConflict:
                d = self._draft(out, "unknown", None, {}, clause, ["strength"])
                self._question(
                    out,
                    d,
                    "strength",
                    f"'{clause}'에 '반드시'류와 '가능하면'류 표현이 함께 있습니다. 강도를 골라 주세요.",
                    [("hard", "반드시(hard)", {"strength": "hard", "weight": None}), ("soft", "가능하면(soft)", {"strength": "soft", "weight": 5})],
                )
                # 유형은 해석하지 않은 채 남기지 않는다: 강도 질문 + 미지원으로도 표시
                out.drafts.pop()
                out.questions.pop()
                out.unsupported.append(
                    {
                        "source_text": clause,
                        "reason_code": "STRENGTH_CONFLICT",
                        "message": "강도 표현이 모순됩니다. 문장을 나눠 다시 입력하거나 수동으로 추가해 주세요.",
                    }
                )
        return out

    # ------------------------------------------------------------ helpers
    def _draft(self, out, type_, strength, params, source, unresolved, **kw) -> dict:
        self._n += 1
        d = {
            "draft_id": f"d{self._n}",
            "type": type_,
            "strength": strength,
            "weight": 5 if strength == "soft" else None,
            "params": params,
            "source_text": source,
            "unresolved_fields": unresolved,
            "action": kw.get("action", "add"),
            "target_constraint_id": kw.get("target"),
        }
        out.drafts.append(d)
        return d

    def _question(self, out, draft, field, message, options):
        self._q += 1
        out.questions.append(
            {
                "id": f"q{self._q}",
                "draft_id": draft["draft_id"] if draft else None,
                "field": field,
                "message": message,
                "options": [{"id": oid, "label": label, "patch": patch} for oid, label, patch in options],
            }
        )

    # ------------------------------------------------------------ main dispatch
    def _clause(self, clause: str, req: ParseRequest, out: ProviderOutput) -> None:
        for pat, code, msg in UNSUPPORTED_RULES:
            if pat.search(clause):
                out.unsupported.append({"source_text": clause, "reason_code": code, "message": msg})
                return
        for handler in (self._delete, self._day_off, self._credits, self._max_days, self._instructor, self._course, self._time):
            if handler(clause, req, out):
                return
        out.unsupported.append(
            {"source_text": clause, "reason_code": "NOT_UNDERSTOOD", "message": "해석하지 못한 요구입니다. 수동 조건으로 추가하거나 문장을 바꿔 주세요."}
        )

    def _delete(self, clause, req, out) -> bool:
        if not re.search(r"취소|삭제|없애|지워|빼버려|철회", clause):
            return False
        if not req.existing_constraints:
            out.unsupported.append({"source_text": clause, "reason_code": "NOTHING_TO_DELETE", "message": "삭제할 기존 조건이 없습니다."})
            return True
        d = self._draft(out, "delete", None, {}, clause, ["target_constraint_id"], action="delete")
        self._question(
            out,
            d,
            "target_constraint_id",
            "어떤 조건을 삭제할까요? (자동으로 삭제하지 않습니다)",
            [(c.id, c.label, {"target_constraint_id": c.id}) for c in req.existing_constraints],
        )
        return True

    def _day_off(self, clause, req, out) -> bool:
        if not re.search(r"공강|비워|비우|수업 ?없|쉬고|쉬었|안 ?가", clause):
            return False
        days = find_days(clause)
        if not days:
            return False
        self._draft(out, "day_off", strength_of(clause), {"days": days}, clause, [])
        return True

    def _credits(self, clause, req, out) -> bool:
        m_range = re.search(r"(\d+(?:\.\d+)?)\s*(?:~|-|에서|부터)\s*(\d+(?:\.\d+)?)\s*학점", clause)
        m_one = re.search(r"(\d+(?:\.\d+)?)\s*학점\s*(이상|이하|넘게|미만|초과)?", clause)
        if not m_range and not m_one:
            return False
        cat_word = re.search(r"전공|교양|전필|전선", clause)
        if cat_word and m_one and m_one.group(2) in ("이상", "넘게", "초과", None):
            units = _units(m_one.group(1))
            if units is None:
                out.unsupported.append({"source_text": clause, "reason_code": "CREDIT_PRECISION", "message": "0.01학점보다 세밀한 값은 지원하지 않습니다."})
                return True
            d = self._draft(out, "category_min", strength_of(clause, numeric_bound=True), {"category_ids": None, "min_units": units}, clause, ["category_ids"])
            opts = []
            for g, cats in req.entities.category_groups.items():
                opts.append((f"group:{g}", f"그룹 '{g}' = {', '.join(cats)}", {"params.category_ids": list(cats)}))
            for cat in req.entities.category_ids:
                opts.append((f"cat:{cat}", f"카테고리 '{cat}'만", {"params.category_ids": [cat]}))
            self._question(out, d, "params.category_ids", f"'{cat_word.group(0)}'에 포함할 카테고리를 확인해 주세요.", opts)
            return True
        if m_range:
            lo, hi = _units(m_range.group(1)), _units(m_range.group(2))
            if lo is None or hi is None or lo > hi:
                out.unsupported.append({"source_text": clause, "reason_code": "INVALID_VALUE", "message": "학점 범위를 해석할 수 없습니다."})
                return True
            self._draft(out, "credit_range", strength_of(clause, True), {"min_units": lo, "max_units": hi}, clause, [])
            return True
        units = _units(m_one.group(1))
        if units is None:
            out.unsupported.append({"source_text": clause, "reason_code": "CREDIT_PRECISION", "message": "0.01학점보다 세밀한 값은 지원하지 않습니다."})
            return True
        bound = m_one.group(2)
        if bound in ("이상", "넘게", "초과"):
            lo = units + (1 if bound == "초과" else 0)
            d = self._draft(out, "credit_range", strength_of(clause, True), {"min_units": lo, "max_units": None}, clause, ["params.max_units"])
            self._question(
                out,
                d,
                "params.max_units",
                "최대 학점도 정해 주세요.",
                [(f"max{lo + k}", f"최대 {(lo + k) / 100:g}학점", {"params.max_units": lo + k}) for k in (0, 300, 600)],
            )
        elif bound in ("이하", "미만"):
            hi = units - (1 if bound == "미만" else 0)
            d = self._draft(out, "credit_range", strength_of(clause, True), {"min_units": None, "max_units": hi}, clause, ["params.min_units"])
            self._question(
                out,
                d,
                "params.min_units",
                "최소 학점도 정해 주세요(0보다 커야 합니다).",
                [(f"min{hi - k}", f"최소 {(hi - k) / 100:g}학점", {"params.min_units": hi - k}) for k in (0, 300, 600) if hi - k > 0],
            )
        else:
            self._draft(out, "credit_range", strength_of(clause, True), {"min_units": units, "max_units": units}, clause, [])
            out.warnings.append(f"'{clause}' → 정확히 {units / 100:g}학점으로 해석했습니다. 칩에서 범위를 수정할 수 있습니다.")
        return True

    def _max_days(self, clause, req, out) -> bool:
        m = re.search(r"(?:주\s*)?(\d)\s*일\s*(?:만|이하|까지)?\s*(?:등교|학교|나가)", clause) or re.search(
            r"등교(?:일)?\s*(?:은|는)?\s*(?:주\s*)?(\d)\s*일", clause
        )
        if not m:
            return False
        self._draft(out, "max_days_on_campus", strength_of(clause, True), {"max_days": int(m.group(1))}, clause, [])
        return True

    def _instructor(self, clause, req, out) -> bool:
        nc = norm(clause)
        hits = [i for i in req.entities.instructors if len(i.name) >= 2 and norm(i.name) in nc]
        if not hits and not re.search(r"교수", clause):
            return False
        if not hits:
            out.unsupported.append(
                {"source_text": clause, "reason_code": "ENTITY_NOT_FOUND", "message": "카탈로그에서 해당 교수를 찾지 못했습니다. 임의로 연결하지 않습니다."}
            )
            return True
        names = {i.name for i in hits}
        if NEG.search(clause):
            d = self._draft(out, "instructor_avoid", strength_of(clause), {"instructor_ids": [i.id for i in hits]}, clause, [])
            if len(hits) > 1:
                d["params"]["instructor_ids"] = None
                d["unresolved_fields"] = ["params.instructor_ids"]
                self._question(
                    out,
                    d,
                    "params.instructor_ids",
                    f"'{'/'.join(names)}' 교수가 여러 명입니다. 누구를 피할까요?",
                    [(i.id, f"{i.name} ({i.id}, 담당: {', '.join(i.course_ids) or '-'})", {"params.instructor_ids": [i.id]}) for i in hits],
                )
            return True
        if re.search(r"선호|좋아|좋겠", clause) and not HARD_CUE.search(clause):
            out.unsupported.append(
                {
                    "source_text": clause,
                    "reason_code": "P1_NOT_IMPLEMENTED",
                    "message": "교수 선호(instructor_prefer)는 아직 지원하지 않습니다. 특정 과목의 해당 교수 분반 필수로 표현할 수 있습니다.",
                }
            )
            return True
        # 교수 + 과목이 같이 있으면 그 과목의 해당 교수 분반으로 must_include
        course_hits = self._match_courses(clause, req)
        courses_by_id = {c.id: c for c in req.entities.courses}
        opts = []
        for i in hits:
            for cid in i.course_ids:
                if course_hits and cid not in {c.id for c in course_hits}:
                    continue
                c = courses_by_id.get(cid)
                if c is None:
                    continue
                secs = sorted(set(i.section_ids).intersection(c.section_ids))
                if secs:
                    opts.append(
                        (f"{i.id}:{cid}", f"{c.name} - {i.name} ({i.id}) 분반 {len(secs)}개", {"params.course_id": cid, "params.allowed_section_ids": secs})
                    )
        d = self._draft(out, "must_include", strength_of(clause), {"course_id": None, "allowed_section_ids": None}, clause, ["params.course_id"])
        if not opts:
            out.drafts.pop()
            out.unsupported.append({"source_text": clause, "reason_code": "ENTITY_NOT_FOUND", "message": "해당 교수의 개설 분반을 찾지 못했습니다."})
            return True
        if len(opts) == 1 and len(hits) == 1:
            _, _, patch = opts[0]
            d["params"] = {"course_id": patch["params.course_id"], "allowed_section_ids": patch["params.allowed_section_ids"]}
            d["unresolved_fields"] = []
            return True
        self._question(out, d, "params.course_id", "어느 과목(교수 분반)을 필수로 할까요?", opts)
        return True

    def _match_courses(self, clause, req):
        nc = norm(clause)
        exact = []
        for c in req.entities.courses:
            nn = norm(c.name)
            code = c.id.lower()
            if len(nn) >= 2 and nn in nc:
                exact.append(c)
            elif re.search(rf"(?<![a-z0-9]){re.escape(code)}(?![a-z0-9])", clause.lower()):
                exact.append(c)
            elif len(nn) < 2 and re.search(rf"(?<![a-z0-9가-힣]){re.escape(nn)}(?![a-z0-9])", nc):
                exact.append(c)
        # 더 긴 이름에 포함된 짧은 이름 매칭 제거 (예: '자료구조'와 '고급자료구조')
        exact = [c for c in exact if not any(o is not c and norm(c.name) in norm(o.name) and norm(o.name) in nc and len(o.name) > len(c.name) for o in exact)]
        return exact

    def _course(self, clause, req, out) -> bool:
        hits = self._match_courses(clause, req)
        intent = POS_COURSE.search(clause) or NEG.search(clause) or re.search(r"과목|수업|강의", clause)
        if not hits:
            if POS_COURSE.search(clause) and re.search(r"과목|수업|강의", clause) and not re.search(r"\d+\s*시", clause):
                out.unsupported.append(
                    {
                        "source_text": clause,
                        "reason_code": "ENTITY_NOT_FOUND",
                        "message": "카탈로그에서 해당 과목을 찾지 못했습니다. 임의의 과목으로 대체하지 않습니다.",
                    }
                )
                return True
            return False
        if not intent:
            return False
        neg = bool(NEG.search(clause))
        type_ = "must_exclude" if neg else "must_include"
        if len(hits) > 1:
            d = self._draft(out, type_, strength_of(clause), {"course_id": None}, clause, ["params.course_id"])
            if type_ == "must_include":
                d["params"]["allowed_section_ids"] = None
            self._question(out, d, "params.course_id", "어느 과목을 말씀하셨나요?", [(c.id, f"{c.name} ({c.id})", {"params.course_id": c.id}) for c in hits])
            return True
        params = {"course_id": hits[0].id}
        if type_ == "must_include":
            params["allowed_section_ids"] = None
        self._draft(out, type_, strength_of(clause), params, clause, [])
        return True

    def _time(self, clause, req, out) -> bool:
        days = find_days(clause) or WEEKDAYS
        m_h = re.search(r"(오전|오후)?\s*(\d{1,2})\s*시\s*(?:(\d{1,2})\s*분)?\s*(이전|전|이후|후|부터|까지)?", clause)
        if re.search(r"아침|오전 ?수업|이른 ?수업|1교시", clause) and not m_h:
            if not NEG.search(clause):
                return False
            d = self._draft(
                out,
                "time_avoid",
                strength_of(clause),
                {"days": days, "start_minute": None, "end_minute": None},
                clause,
                ["params.start_minute", "params.end_minute"],
            )
            self._question(
                out,
                d,
                "params.time_window",
                "'아침'의 정확한 시간대를 골라 주세요.",
                [
                    (
                        f"before{h}",
                        f"{h:02d}:00 이전에 끝나지 않는 수업 회피 (00:00~{h:02d}:00과 겹침)",
                        {"params.start_minute": 0, "params.end_minute": h * 60},
                    )
                    for h in (9, 10, 11)
                ],
            )
            return True
        if re.search(r"저녁|야간", clause) and not m_h:
            if not NEG.search(clause):
                return False
            d = self._draft(out, "time_avoid", strength_of(clause), {"days": days, "start_minute": None, "end_minute": 1440}, clause, ["params.start_minute"])
            self._question(
                out,
                d,
                "params.start_minute",
                "'저녁'의 시작 시각을 골라 주세요.",
                [(f"after{h}", f"{h:02d}:00 이후 수업 회피", {"params.start_minute": h * 60}) for h in (17, 18, 19)],
            )
            return True
        if not m_h:
            return False
        ampm, h, mi, rel = m_h.group(1), int(m_h.group(2)), int(m_h.group(3) or 0), m_h.group(4)
        if h > 24 or mi >= 60:
            return False
        if ampm == "오후" and h < 12:
            h += 12
        elif ampm is None and 1 <= h <= 7:
            h += 12
            out.warnings.append(f"'{clause}'의 {h - 12}시를 오후 {h - 12}시({h:02d}:00)로 해석했습니다.")
        t = h * 60 + mi
        if t > 1440:
            return False
        if rel in ("이전", "전", "까지"):
            if not NEG.search(clause):
                return False
            self._draft(out, "time_avoid", strength_of(clause), {"days": days, "start_minute": 0, "end_minute": t}, clause, [])
            return True
        if rel in ("이후", "후", "부터"):
            if not NEG.search(clause) or t >= 1440:
                return False
            self._draft(out, "time_avoid", strength_of(clause), {"days": days, "start_minute": t, "end_minute": 1440}, clause, [])
            return True
        if not re.search(r"수업|강의", clause):
            return False
        if not NEG.search(clause):
            out.unsupported.append(
                {"source_text": clause, "reason_code": "P1_NOT_IMPLEMENTED", "message": "시간대 선호(time_prefer)는 아직 지원하지 않습니다."}
            )
            return True
        end = min(1440, t + 60)
        d = self._draft(out, "time_avoid", strength_of(clause), {"days": days, "start_minute": t, "end_minute": end}, clause, ["interpretation"])
        self._question(
            out,
            d,
            "interpretation",
            f"'{h}시 수업'은 어떤 뜻인가요? 확인 전에는 적용할 수 없습니다.",
            [
                ("window", f"{h:02d}:{mi:02d}~{end // 60:02d}:{end % 60:02d} 시간대와 겹치는 수업 회피", {}),
                ("start_only", f"{h:02d}:{mi:02d}에 시작하는 수업만 회피 — 지원하지 않음(초안 버림)", {"discard": True}),
            ],
        )
        return True


def _units(text: str) -> int | None:
    from app.domain.catalog import CreditParseError, credit_to_units

    try:
        return credit_to_units(text)
    except CreditParseError:
        return None
