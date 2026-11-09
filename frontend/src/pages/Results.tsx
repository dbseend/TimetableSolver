import { useState } from "react";
import { postSolve, type Catalog, type Constraint, type SolveResult } from "../api/client";
import TimetableGrid, { blocksFor } from "../components/TimetableGrid";
import { summarize } from "../constraints";
import { useSession } from "../state";
import { parseConstraints } from "./Preferences";

const STATUS: Record<SolveResult["status"], string> = {
  OPTIMAL: "최적 후보를 찾았다",
  FEASIBLE: "시간 제한 안에서 찾은 후보 (최적 보장 없음)",
  INFEASIBLE: "조건을 모두 만족하는 시간표가 없다",
  UNKNOWN: "시간 제한 안에 답을 찾지 못했다",
};


function totalCredits(catalog: Catalog, sectionIds: string[]): number {
  const courses = new Map(catalog.courses.map((c) => [c.id, c]));
  return catalog.sections
    .filter((s) => sectionIds.includes(s.id))
    .reduce((sum, s) => sum + (s.credit ?? courses.get(s.course_id)?.credit ?? 0), 0);
}

export default function Results() {
  const { catalog, pool, constraintsText, setConstraintsText, result, setResult } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseConstraints(constraintsText);
  const constraints = ("value" in parsed ? parsed.value : []) as Constraint[];
  const byId = new Map(constraints.map((c) => [c.id, c]));
  const describe = (c: Constraint | undefined, id: string) =>
    c ? (c.source_text ?? summarize(c, catalog)) : id;

  const blocker = !catalog
    ? "준비 단계에서 개설강좌를 불러온다."
    : pool.length === 0
      ? "준비 단계에서 관심 과목을 1개 이상 담는다."
      : "error" in parsed
        ? `선호 단계의 제약을 고친다: ${parsed.error}`
        : null;

  async function run(list: Constraint[]) {
    if (!catalog) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await postSolve({ catalog, pool, constraints: list, n: 3, diversity_k: 1 }));
    } catch (e) {
      setResult(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function dropAndRerun(id: string) {
    const rest = constraints.filter((c) => c.id !== id);
    setConstraintsText(JSON.stringify(rest, null, 2));
    void run(rest);
  }

  return (
    <section>
      <h2>3. 결과</h2>
      {blocker ? (
        <p>{blocker}</p>
      ) : (
        <button onClick={() => run(constraints)} disabled={busy}>
          {busy ? "푸는 중…" : "시간표 만들기"}
        </button>
      )}
      {error && <p role="alert">요청 실패: {error}</p>}

      {result && catalog && (
        <>
          <p>
            <strong>{STATUS[result.status]}</strong> · 후보 {result.candidates?.length ?? 0}개 · 대상 분반{" "}
            {result.stats.n_sections_after_filter}개 · {result.stats.solve_ms}ms
          </p>

          {result.diagnosis && (
            <div role="region" aria-label="진단" style={{ border: "1px solid #f28b82", padding: 12, borderRadius: 6 }}>
              <h3 style={{ marginTop: 0 }}>함께 만족할 수 없는 조건</h3>
              <ul>
                {result.diagnosis.core.map((id) => (
                  <li key={id}>{describe(byId.get(id), id)}</li>
                ))}
              </ul>
              {(result.diagnosis.relaxations ?? []).length > 0 && (
                <>
                  <h4>하나를 빼면</h4>
                  <ul>
                    {result.diagnosis.relaxations!.map((r) => (
                      <li key={r.drop}>
                        “{describe(byId.get(r.drop), r.drop)}” 빼면:{" "}
                        {r.feasible
                          ? r.objective_delta
                            ? `가능 (조건이 없을 때보다 ${-r.objective_delta}점 낮음)`
                            : "가능 (손실 없음)"
                          : "여전히 불가능"}{" "}
                        {r.feasible && (
                          <button onClick={() => dropAndRerun(r.drop)} disabled={busy}>
                            이 조건 빼고 다시 풀기
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          {(result.candidates ?? []).map((c, i) => (
            <article key={c.sections.join(",")} aria-label={`후보 ${i + 1}`} style={{ marginTop: 24 }}>
              <h3>
                후보 {i + 1} · {totalCredits(catalog, c.sections)}학점 · {c.sections.length}개 분반
              </h3>
              <TimetableGrid blocks={blocksFor(catalog, c.sections)} />
              {c.violated.length > 0 && (
                <p>
                  못 지킨 선호:{" "}
                  {c.violated.map((v) => `${describe(byId.get(v.id), v.id)} (${v.amount})`).join(", ")}
                </p>
              )}
            </article>
          ))}
        </>
      )}
    </section>
  );
}
