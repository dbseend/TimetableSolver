"""검증된 선택 결과에서만 계산하는 사실(facts). UI 템플릿 설명의 근거."""

from __future__ import annotations

from app.contracts import DAYS, Fact
from app.domain.catalog import CatalogIndex


def compute_facts(idx: CatalogIndex, selected: list[str]) -> list[Fact]:
    sections = [idx.section_by_id[s] for s in selected]
    facts: list[Fact] = []
    total = sum(idx.units_of(s.id) for s in sections)
    facts.append(Fact(fact_id="total_credits", type="total_credit_units", payload={"credit_units": total}))
    class_days = [d for d in DAYS if any(m.day == d for s in sections for m in s.meetings)]
    campus_days = [d for d in DAYS if any(m.day == d and m.campus_required for s in sections for m in s.meetings)]
    facts.append(Fact(fact_id="class_days", type="class_days", payload={"days": class_days, "count": len(class_days)}))
    facts.append(Fact(fact_id="campus_days", type="campus_days", payload={"days": campus_days, "count": len(campus_days)}))
    for d in class_days:
        ms = [m for s in sections for m in s.meetings if m.day == d]
        facts.append(
            Fact(
                fact_id=f"day_span_{d}",
                type="day_span",
                payload={
                    "day": d,
                    "first_start_minute": min(m.start_minute for m in ms),
                    "last_end_minute": max(m.end_minute for m in ms),
                    "meeting_count": len(ms),
                },
            )
        )
    async_ids = [s.id for s in sections if s.delivery_mode == "online_async"]
    facts.append(Fact(fact_id="async_sections", type="async_sections", payload={"section_ids": async_ids}))
    return facts
