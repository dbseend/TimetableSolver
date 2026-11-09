"""3-way comparison (PLAN §12.2), (B) LLM+code execution dropped (design §6 scope order).

(A) the LLM picks sections directly from the full catalog; (C) this system's solver.
Both get the same catalog, pool and constraint JSON, and are graded by the independent
validator and the shared objective (app/core/objective.py).

python eval/compare.py --model gemini-3.5-flash-lite --out ../docs/eval/compare.json
"""

import argparse
import json
import random
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from pydantic import BaseModel  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.core.objective import score  # noqa: E402
from app.domain.api_models import SolveRequest  # noqa: E402
from app.llm.provider import CachedProvider, GeminiProvider, LLMError  # noqa: E402
from app.main import LLM_CACHE_DIR  # noqa: E402
from app.solver.solve import solve  # noqa: E402

DATA = ROOT.parent / "data" / "synthetic"
SYSTEM = (Path(__file__).parent / "prompts_direct.md").read_text(encoding="utf-8")
SIZES = (50, 200, 500)


class DirectAnswer(BaseModel):
    feasible: bool
    sections: list[str]
    reason: str = ""


WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri"]


def rule(cid: str, type_: str, strength: str, weight: int = 5, **params) -> dict:
    return {"id": cid, "type": type_, "strength": strength, "weight": weight, "params": params}


def feasible_scenarios(catalog: dict, n: int, seed: int) -> list[dict]:
    """Random pools of 8 timed courses with a fixed mix of hard and soft rules; kept if solvable."""
    rng = random.Random(seed)
    timed = sorted({s["course_id"] for s in catalog["sections"] if s["meetings"]})
    instructors = sorted({s["instructor"] for s in catalog["sections"] if s["instructor"]})
    out = []
    while len(out) < n:
        pool = [{"course_id": c, "priority": rng.randint(1, 5)} for c in rng.sample(timed, 8)]
        rules = [
            rule("c1", "credit_range", "hard", min=9, max=18),
            rule("c2", "time_avoid", "hard", days=WEEK, start="08:00", end="09:00"),
            rule("c3", "day_off", "soft", 7, days=[rng.choice(["Mon", "Wed", "Fri"])]),
            rule("c4", "lunch_free", "soft", 5, start="12:00", end="13:00", min_free_minutes=60),
            rule("c5", "max_consecutive", "soft", 5, minutes=150),
            rule("c6", "instructor_avoid", "soft", 3, instructor=rng.choice(instructors)),
        ]
        req = {"catalog": catalog, "pool": pool, "constraints": rules, "n": 1}
        if solve(SolveRequest.model_validate(req), 5).status == "OPTIMAL":
            out.append({"id": f"f{len(out) + 1}", "request": req, "expect": "FEASIBLE"})
    return out


def infeasible_scenarios(catalog: dict) -> list[dict]:
    scen = json.loads((DATA / "infeasible_scenarios.json").read_text(encoding="utf-8"))
    pool = [{"course_id": c["id"]} for c in catalog["courses"]]
    return [
        {
            "id": s["id"],
            "request": {"catalog": catalog, "pool": pool, "constraints": s["constraints"], "n": 1},
            "expect": "INFEASIBLE",
        }
        for s in scen["scenarios"]
    ]


def compact(req: SolveRequest) -> str:
    courses = {c.id: c for c in req.catalog.courses}
    sections = [
        {
            "id": s.id,
            "course": s.course_id,
            "name": courses[s.course_id].name,
            "credit": req.catalog.credit_and_category(s)[0],
            "category": req.catalog.credit_and_category(s)[1],
            "instructor": s.instructor,
            "meetings": [f"{m.day} {m.start}-{m.end}" for m in s.meetings],
        }
        for s in req.catalog.sections
    ]
    body = {
        "sections": sections,
        "pool": [p.model_dump() for p in req.pool],
        "constraints": [c.model_dump(exclude_none=True) for c in req.constraints],
    }
    return json.dumps(body, ensure_ascii=False)


def run_direct(provider, req: SolveRequest) -> tuple[DirectAnswer | None, float, str]:
    started = time.perf_counter()
    for attempt in range(4):
        try:
            raw = provider.generate_json(SYSTEM, compact(req), DirectAnswer.model_json_schema())
            return DirectAnswer.model_validate_json(raw), time.perf_counter() - started, ""
        except LLMError as e:
            if e.code == "llm_daily_limit" or attempt == 3:
                return None, time.perf_counter() - started, e.code
            time.sleep(15 * (attempt + 1))
        except ValueError:
            return None, time.perf_counter() - started, "invalid_output"
    return None, time.perf_counter() - started, "unreachable"


def grade(
    req: SolveRequest, sections: list[str], claimed_feasible: bool, expect: str, best: int | None
):
    known = {s.id for s in req.catalog.sections}
    report, objective = score(req.catalog, req.pool, req.constraints, sections)
    valid = report.feasible(req.constraints)
    row = {
        "claimed_feasible": claimed_feasible,
        "hallucinated": sum(sid not in known for sid in sections),
        "structural": report.structural,
        "hard_violations": report.hard_violations(req.constraints),
        "valid": valid if claimed_feasible else None,
        "objective": objective if claimed_feasible and valid else None,
    }
    if expect == "INFEASIBLE":
        row["correct"] = not claimed_feasible
    else:
        row["correct"] = claimed_feasible and valid
        if row["objective"] is not None and best:
            row["optimality"] = round(row["objective"] / best, 3) if best > 0 else None
    return row


def summarize(rows: list[dict]) -> str:
    """Markdown table: per catalog size and method."""
    import statistics

    header = [
        "규모",
        "방법",
        "정답 시간표",
        "hard 위반",
        "없는 분반 제안",
        "잘못된 '불가능'",
        "최적 대비 점수",
        "불가능 판정",
        "중앙 시간",
    ]
    lines = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    for size in SIZES:
        for key, label in (("solver", "본 시스템"), ("llm_direct", "LLM 직접")):
            feas = [r[key] for r in rows if r["size"] == size and r["expect"] == "FEASIBLE"]
            inf = [r[key] for r in rows if r["size"] == size and r["expect"] == "INFEASIBLE"]
            answered = [x for x in feas if "error" not in x and x["claimed_feasible"]]
            opt = [x["optimality"] for x in feas if x.get("optimality") is not None]
            secs = [x["seconds"] for x in feas + inf]
            opt_cell = f"{statistics.mean(opt):.2f} (n={len(opt)})" if opt else "–"
            inf_cell = f"{sum(x['correct'] for x in inf)}/{len(inf)}" if inf else "–"
            cells = [
                str(size),
                label,
                f"{sum(x['correct'] for x in feas)}/{len(feas)}",
                f"{sum(x['valid'] is False for x in answered)}/{len(answered)}",
                f"{sum(x.get('hallucinated', 0) > 0 for x in feas)}/{len(feas)}",
                f"{sum('error' not in x and not x['claimed_feasible'] for x in feas)}/{len(feas)}",
                opt_cell,
                inf_cell,
                f"{statistics.median(secs):.2f}s",
            ]
            lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=None)
    ap.add_argument("--per-size", type=int, default=8)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--summary-only", action="store_true", help="re-print the table from --out")
    args = ap.parse_args()
    if args.summary_only:
        print(summarize(json.loads(args.out.read_text(encoding="utf-8"))["rows"]))
        return 0
    settings = get_settings()
    if not settings.llm_enabled:
        print("LLM disabled: set LLM_PROVIDER=gemini and LLM_API_KEY")
        return 1
    model = args.model or settings.llm_model
    provider = CachedProvider(
        GeminiProvider(settings.llm_api_key.get_secret_value(), model), LLM_CACHE_DIR, 10_000
    )
    rows = []
    for size in SIZES:
        catalog = json.loads((DATA / f"catalog_{size}.json").read_text(encoding="utf-8"))
        scenarios = feasible_scenarios(catalog, args.per_size, seed=size)
        if size == 50:
            scenarios += infeasible_scenarios(catalog)
        for sc in scenarios:
            req = SolveRequest.model_validate(sc["request"])
            t = time.perf_counter()
            result = solve(req, 5)
            solver_s = time.perf_counter() - t
            best = result.candidates[0].objective if result.candidates else None
            chosen = result.candidates[0].sections if result.candidates else []
            ours = grade(req, chosen, result.status != "INFEASIBLE", sc["expect"], best)
            answer, llm_s, err = run_direct(provider, req)
            direct = (
                grade(req, answer.sections, answer.feasible, sc["expect"], best)
                if answer
                else {"error": err, "correct": False}
            )
            rows.append(
                {
                    "size": size,
                    "scenario": sc["id"],
                    "expect": sc["expect"],
                    "solver": {**ours, "seconds": round(solver_s, 3)},
                    "llm_direct": {**direct, "seconds": round(llm_s, 2)},
                }
            )
            print(
                size,
                sc["id"],
                "solver",
                ours["correct"],
                "| llm",
                direct.get("correct"),
                direct.get("error", ""),
            )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps({"model": model, "rows": rows}, ensure_ascii=False, indent=1) + "\n",
        encoding="utf-8",
    )
    print(summarize(rows))
    return 0


if __name__ == "__main__":
    sys.exit(main())
