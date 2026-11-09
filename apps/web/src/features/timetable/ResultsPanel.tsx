import { type KeyboardEvent, useState } from "react";
import type { Candidate, Catalog, Constraint, SolveResponse } from "../../lib/types";
import { DAY_KO } from "../../lib/types";
import { fmtCredits, fmtMin } from "../../lib/time";
import { Badge, Icon, Segmented } from "../../ui";
import { describe, STRENGTH_LABEL, TYPE_LABEL } from "../constraints/model";
import { axisFor, courseColor, instructorNames, SectionDetail, TimetableGrid } from "./TimetableGrid";

type Payload = Record<string, never>;
const fact = (c: Candidate, id: string) => c.facts.find((f) => f.fact_id === id)?.payload as Payload | undefined;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

export function candidateSummary(c: Candidate) {
  const spans = c.facts.filter((f) => f.type === "day_span").map((f) => f.payload as { first_start_minute: number; last_end_minute: number });
  const campus = fact(c, "campus_days") as { days: string[]; count: number } | undefined;
  const classDays = fact(c, "class_days") as { days: string[]; count: number } | undefined;
  return {
    campusDays: campus?.count ?? 0,
    campusDayList: (campus?.days ?? []).map((d) => DAY_KO[d as keyof typeof DAY_KO]).join(""),
    freeWeekdays: WEEKDAYS.filter((d) => !(classDays?.days ?? []).includes(d)),
    earliest: spans.length ? Math.min(...spans.map((s) => s.first_start_minute)) : null,
    latest: spans.length ? Math.max(...spans.map((s) => s.last_end_minute)) : null,
  };
}

const UNIT_KO: Record<string, string> = { meetings: "개 수업", sections: "개 분반", days: "일", count: "개" };
export const violationText = (v: number, unit: string) => (unit === "credit_units" ? `${fmtCredits(v)}학점` : `${v}${UNIT_KO[unit] ?? " " + unit}`);

const REASON: Record<SolveResponse["search"]["termination_reason"], string> = {
  requested_count: "요청한 개수만큼 찾았어요.",
  exhausted_under_diversity: "서로 다른 후보(최소 분반 거리 조건)를 더 찾을 수 없었어요. 원래 조건이 불가능하다는 뜻은 아닙니다.",
  time_limit: "시간 한도 때문에 추가 후보 탐색을 끝내지 못했어요.",
  not_started: "탐색을 시작하지 못했어요.",
};

export function ResultsPanel({
  catalog,
  response,
  selected,
  constraints,
  onSelect,
}: {
  catalog: Catalog;
  response: SolveResponse;
  selected: number;
  constraints: Constraint[];
  onSelect: (i: number) => void;
}) {
  const [view, setView] = useState<"grid" | "list">("grid");
  const [detail, setDetail] = useState<string | null>(null);
  const cands = response.candidates;
  const cur = cands[selected];
  const byId = new Map(constraints.map((c) => [c.id, c]));
  const axis = axisFor(
    catalog,
    cands.map((c) => c.selected_section_ids),
  );
  const softEvals = cur.constraint_evaluations.filter((e) => e.strength === "soft");
  const hardCount = cur.constraint_evaluations.filter((e) => e.strength === "hard").length;
  const met = softEvals.filter((e) => e.satisfied);
  const missed = softEvals.filter((e) => !e.satisfied);
  const sum = candidateSummary(cur);
  const label = (id: string) => {
    const c = byId.get(id);
    return c ? describe(c, catalog) : id;
  };

  function onTabKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const n = (selected + (e.key === "ArrowRight" ? 1 : cands.length - 1)) % cands.length;
    onSelect(n);
    setDetail(null);
    (e.currentTarget.querySelector(`[data-i="${n}"]`) as HTMLButtonElement | null)?.focus();
  }

  return (
    <div className="stack" data-testid="results">
      <div className="result-head">
        <div>
          <h2>
            추천 후보 <span data-testid="candidate-count">{cands.length}</span>개
          </h2>
          <p className="small muted">
            {REASON[response.search.termination_reason]} 요청 {response.search.requested_count}개, 후보끼리 최소 {response.search.min_section_distance}개 분반이 달라요.
          </p>
        </div>
      </div>

      <div className="cand-tabs" role="tablist" aria-label="후보 선택" onKeyDown={onTabKey}>
        {cands.map((c, i) => {
          const s = candidateSummary(c);
          return (
            <button
              key={c.id}
              type="button"
              role="tab"
              data-i={i}
              className="cand-tab"
              aria-selected={i === selected}
              tabIndex={i === selected ? 0 : -1}
              onClick={() => {
                onSelect(i);
                setDetail(null);
              }}
              data-testid={`cand-tab-${i}`}
            >
              <span className="t">후보 {i + 1}</span>
              <span className="facts">
                <Badge>{fmtCredits(c.total_credit_units)}학점</Badge>
                <Badge>등교 {s.campusDays}일</Badge>
                {s.freeWeekdays.map((d) => (
                  <Badge key={d}>{DAY_KO[d]} 공강</Badge>
                ))}
              </span>
            </button>
          );
        })}
      </div>

      <div className="summary" aria-label={`후보 ${selected + 1} 요약`}>
        <div className="item">
          <span className="k">총 학점</span>
          <span className="v">{fmtCredits(cur.total_credit_units)}</span>
        </div>
        <div className="item">
          <span className="k">등교일</span>
          <span className="v">{sum.campusDays}일</span>
          {sum.campusDayList && <span className="small muted">({sum.campusDayList})</span>}
        </div>
        <div className="item">
          <span className="k">선호 조건</span>
          <span className="v">{softEvals.length ? `${met.length}/${softEvals.length}` : "—"}</span>
          <span className="small muted">{softEvals.length ? "충족" : "선호 조건 없음"}</span>
        </div>
        <div className="item">
          {cur.optimality_proven ? <Badge tone="success">✓ 최적 입증</Badge> : <Badge>유효 · 최적 미입증</Badge>}
          <Badge tone="success">✓ 독립 검증 통과</Badge>
        </div>
      </div>

      <div className="row between">
        <h3>후보 {selected + 1} 시간표</h3>
        <Segmented
          label="보기 방식"
          value={view}
          onChange={setView}
          options={[
            { value: "grid", label: "시간표" },
            { value: "list", label: "목록" },
          ]}
        />
      </div>
      {view === "grid" && <TimetableGrid catalog={catalog} sectionIds={cur.selected_section_ids} axis={axis} selectedSection={detail} onSelectSection={setDetail} testId="grid" />}
      {detail && <SectionDetail catalog={catalog} sectionId={detail} onClose={() => setDetail(null)} />}

      <ul className="list-view" data-testid="selected-sections" aria-label={`후보 ${selected + 1} 수업 목록`} hidden={view === "grid" ? undefined : undefined}>
        {cur.selected_section_ids.map((id) => {
          const s = catalog.sections.find((x) => x.id === id)!;
          const c = catalog.courses.find((x) => x.id === s.course_id)!;
          return (
            <li key={id}>
              <span className="sw" style={{ background: courseColor(c.id)[2] }} aria-hidden />
              <span>
                <b>{c.name}</b> <span className="muted">({c.id}) {s.section_label}분반</span>
                <br />
                <span className="num">
                  {s.meetings.length ? s.meetings.map((m) => `${DAY_KO[m.day]} ${fmtMin(m.start_minute)}-${fmtMin(m.end_minute)}`).join(", ") : "시간 없음(비동기)"}
                </span>
                {instructorNames(catalog, s) && <span className="muted"> · {instructorNames(catalog, s)}</span>}
              </span>
              <span className="num strong">{fmtCredits(c.credit_units)}학점</span>
            </li>
          );
        })}
      </ul>

      <div className="sat-grid">
        <div>
          <h4>충족한 조건</h4>
          <ul className="sat-list">
            <li>
              <span className="ok">
                <Icon name="check" />
              </span>
              <span>꼭 지키기 조건 {hardCount}개 모두 충족 (시간 충돌 없음, 독립 검증기 확인)</span>
            </li>
            {met.map((e) => (
              <li key={e.constraint_id}>
                <span className="ok">
                  <Icon name="check" />
                </span>
                <span>
                  {label(e.constraint_id)} <span className="muted xs">· {STRENGTH_LABEL.soft} · 중요도 {e.weight}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4>아쉬운 조건</h4>
          {missed.length === 0 ? (
            <p className="small muted" style={{ marginTop: 8 }}>
              {softEvals.length ? "가능하면 조건을 모두 충족했어요." : "가능하면 조건이 없어요."}
            </p>
          ) : (
            <ul className="sat-list">
              {missed.map((e) => (
                <li key={e.constraint_id}>
                  <span className="error">
                    <Icon name="x" />
                  </span>
                  <span>
                    {label(e.constraint_id)} — <b>{violationText(e.violation, e.unit)}</b> 어긋남
                    {e.evidence.length > 0 && <span className="muted xs"> ({e.evidence.slice(0, 3).join(", ")})</span>}
                    <span className="muted xs"> · 중요도 {e.weight}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <details>
        <summary>후보 비교표</summary>
        <div className="table-scroll" style={{ marginTop: 8 }}>
          <table className="table compare" data-testid="compare">
            <thead>
              <tr>
                <th scope="col">항목</th>
                {cands.map((c, i) => (
                  <th key={c.id} scope="col">
                    후보 {i + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">상태</th>
                {cands.map((c) => (
                  <td key={c.id}>{c.optimality_proven ? "최적 입증 · 검증 통과" : "유효(최적 미입증) · 검증 통과"}</td>
                ))}
              </tr>
              <tr>
                <th scope="row">학점</th>
                {cands.map((c) => (
                  <td key={c.id} className="num">
                    {fmtCredits(c.total_credit_units)}
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row">등교일</th>
                {cands.map((c) => {
                  const s = candidateSummary(c);
                  return (
                    <td key={c.id}>
                      {s.campusDays}일 {s.campusDayList && `(${s.campusDayList})`}
                    </td>
                  );
                })}
              </tr>
              <tr>
                <th scope="row">가장 이른 / 늦은 수업</th>
                {cands.map((c) => {
                  const s = candidateSummary(c);
                  return (
                    <td key={c.id} className="num">
                      {s.earliest === null ? "-" : `${fmtMin(s.earliest)} / ${fmtMin(s.latest!)}`}
                    </td>
                  );
                })}
              </tr>
              <tr>
                <th scope="row">선호 점수</th>
                {cands.map((c) => (
                  <td key={c.id}>{c.original_soft_score === null ? "선호 조건 없음" : `${Math.round(c.original_soft_score)}점 (벌점 ${c.objective_penalty})`}</td>
                ))}
              </tr>
              {constraints
                .filter((c) => c.strength === "soft")
                .map((sc) => (
                  <tr key={sc.id}>
                    <th scope="row">
                      {TYPE_LABEL[sc.type]}: {describe(sc, catalog)}
                    </th>
                    {cands.map((c) => {
                      const e = c.constraint_evaluations.find((x) => x.constraint_id === sc.id);
                      return (
                        <td key={c.id} className={e?.satisfied ? "good" : "bad"}>
                          {e ? (e.satisfied ? "✓ 충족" : `✕ ${violationText(e.violation, e.unit)}`) : "-"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="xs muted" style={{ marginTop: 8 }}>
          선호 점수 = 100 × (1 − 어긋난 가능하면 조건의 중요도 합 ÷ 전체 중요도 합). 조건별 충족 여부만 보는 거친 점수이며 확률이 아닙니다. 후보는 다양성 조건 아래 순서대로 찾은 결과로, 전체 상위 N개를
          보장하지 않습니다.
        </p>
      </details>
      <p className="xs muted">
        계산 {Math.round(response.timing.total_ms)}ms · 요청 {response.request_id}
      </p>
    </div>
  );
}
