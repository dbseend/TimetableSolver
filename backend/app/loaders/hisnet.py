"""Adapter: HISNet 개설시간표 -> Catalog.

Two inputs (docs/academic_rules.md §6):
- text copied from the web result table (tab-separated, times like "Mon1,Thu1"), via `parse`;
- the "excel" download, which is really an HTML table in CP949, via `parse_export`. There the
  time cell is "월1,목1 Mon1,Thu1" (the English half is sometimes truncated, so Korean wins) and
  the instructor sits in 개설정보 as "<개설학부> 주간<교수>[외 N명]".
Columns are looked up by header name (spaces and "(English)" suffixes ignored).
"""

import re
from html.parser import HTMLParser

from pydantic import ValidationError

from app.core.time_slots import format_hhmm
from app.domain.api_models import RowError
from app.domain.models import Catalog, Course, Section

# Period n starts at 09:00 + (n-1)*90min; a class lasts 75min for 3-credit courses and 50min
# for 2-credit ones (confirmed by the user for 2026-2, docs/academic_rules.md §1).
FIRST_PERIOD_MIN = 9 * 60
PERIOD_STEP_MIN = 90


def period_len(credit: float) -> int:
    # shortcut: credits other than 2 and 3 are unconfirmed; >=3 -> 75, else 50 (50min per credit
    # rule, Academic Regulation art. 42). Revisit if real 1- or 4+-credit timings differ.
    return 75 if credit >= 3 else 50


_SLOT = re.compile(r"^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)(\d{1,2})$")
_KO_SLOT = re.compile(r"^([월화수목금토일])(\d{1,2})$")
_KO_DAY = dict(
    zip("월화수목금토일", ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"), strict=True)
)
_OPENER = re.compile(r"^\S+\s+(?:주간|야간)(.*?)(?:\s*외\s*\d+명)?$")
REQUIRED = ("구분", "과목코드", "분반", "과목명", "학점", "시간")


def period_start(n: int) -> int:
    return FIRST_PERIOD_MIN + (n - 1) * PERIOD_STEP_MIN


def parse_time(value: str, credit: float = 3) -> list[dict]:
    """'Mon1,Thu1,Thu2' or '월1,목1 Mon1,Thu1' -> meetings; consecutive periods merge."""
    tokens = [t for t in re.split(r"[,\s]+", value) if t]
    korean = [m for t in tokens if (m := _KO_SLOT.match(t))]
    if korean:  # the English half of an export cell may be truncated ("Wed5,ed6")
        slots = [(_KO_DAY[m.group(1)], int(m.group(2))) for m in korean]
    else:
        slots = []
        for token in tokens:
            m = _SLOT.match(token)
            if not m:
                raise ValueError(f"invalid time token {token!r}")
            slots.append((m.group(1), int(m.group(2))))
    by_day: dict[str, list[int]] = {}
    for day, period in slots:
        if period < 1:
            raise ValueError(f"invalid period {period}")
        by_day.setdefault(day, []).append(period)
    meetings = []
    for day, periods in by_day.items():
        periods = sorted(set(periods))
        run = [periods[0]]
        for p in [*periods[1:], None]:
            if p is not None and p == run[-1] + 1:
                run.append(p)
                continue
            end = period_start(run[-1]) + period_len(credit)
            meetings.append(
                {"day": day, "start": format_hhmm(period_start(run[0])), "end": format_hhmm(end)}
            )
            if p is not None:
                run = [p]
    return meetings


def parse(text: str) -> tuple[Catalog | None, list[RowError]]:
    lines = [ln.rstrip("\r") for ln in text.splitlines() if ln.strip()]
    header_idx = next((i for i, ln in enumerate(lines) if "과목코드" in ln.split("\t")), None)
    if header_idx is None:
        return None, [RowError(kind="section", index=0, message="header row (과목코드) not found")]
    header = [re.sub(r"\(.*?\)|\s", "", h) for h in lines[header_idx].split("\t")]
    if missing := [h for h in REQUIRED if h not in header]:
        return None, [RowError(kind="section", index=0, message=f"missing columns {missing}")]
    col = {h: i for i, h in enumerate(header)}

    courses: dict[str, Course] = {}
    sections: list[Section] = []
    errors: list[RowError] = []
    for index, line in enumerate(lines[header_idx + 1 :]):
        cells = line.split("\t")
        row = {h: (cells[i].strip() if i < len(cells) else "") for h, i in col.items()}
        try:
            code = row["과목코드"]
            course = Course(
                id=code, name=row["과목명"], credit=float(row["학점"]), category=row["구분"]
            )
            # the first section defines the course; later sections keep differences as overrides
            base = courses.get(code, course)
            if base.name != course.name:
                raise ValueError(f"course {code} has different names between sections")
            capacity = row.get("정원", "")
            sections.append(
                Section(
                    id=f"{code}-{row['분반']}",
                    course_id=code,
                    meetings=parse_time(row["시간"], course.credit),
                    instructor=row.get("교수") or _instructor(row.get("개설정보", "")),
                    capacity=int(capacity) if capacity.isdigit() else None,
                    credit=None if course.credit == base.credit else course.credit,
                    category=None if course.category == base.category else course.category,
                )
            )
            courses.setdefault(code, course)
        except (ValueError, ValidationError) as e:
            # message only: never echo the row (names are real data)
            errors.append(RowError(kind="section", index=index, message=_short(e)))
    try:
        return Catalog(courses=list(courses.values()), sections=sections), errors
    except ValidationError as e:
        return None, [*errors, RowError(kind="section", index=0, message=_short(e))]


def _instructor(opener: str) -> str | None:
    m = _OPENER.match(opener)
    return (m.group(1).strip() or None) if m else (opener or None)


class _Table(HTMLParser):
    """Rows of the largest <table>, cell text whitespace-collapsed."""

    def __init__(self) -> None:
        super().__init__()
        self.tables: list[list[list[str]]] = []
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self.tables.append([])
        elif tag == "tr":
            self._row = []
        elif tag in ("td", "th"):
            self._cell = []

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self._cell is not None and self._row is not None:
            self._row.append(" ".join("".join(self._cell).split()))
            self._cell = None
        elif tag == "tr" and self._row is not None and self.tables:
            self.tables[-1].append(self._row)
            self._row = None

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)


def parse_export(raw: bytes) -> tuple[Catalog | None, list[RowError]]:
    """The HISNet '.xls' download (an HTML table, CP949)."""
    t = _Table()
    t.feed(raw.decode("cp949", errors="replace"))
    rows = max(t.tables, key=len, default=[])
    return parse("\n".join("\t".join(r) for r in rows))


def _short(e: Exception) -> str:
    if isinstance(e, ValidationError):
        return "; ".join(f"{'.'.join(map(str, x['loc']))}: {x['msg']}" for x in e.errors())
    return str(e)
