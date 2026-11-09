import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { storage } from "../lib/storage";
import type { Capabilities, Constraint, RelaxationProposal, SolveRequest } from "../lib/types";
import { CatalogPanel, DataSummary } from "../features/catalog/CatalogPanel";
import { ProfilePanel } from "../features/profile/ProfilePanel";
import { computeEligibility } from "../features/profile/eligibility";
import { type ProfileEntry, rematchProfile } from "../features/profile/transcript";
import { ConstraintForm, ConstraintList } from "../features/constraints/ConstraintEditor";
import { NlPanel } from "../features/constraints/NlPanel";
import { buildEntities, describe } from "../features/constraints/model";
import { ReviewPanel } from "../features/review/ReviewPanel";
import { reviewItems } from "../features/review/review";
import { ResultsPanel } from "../features/timetable/ResultsPanel";
import { DiagnosisPanel } from "../features/diagnostics/DiagnosisPanel";
import { Alert, Badge, Button, Card, Icon, Segmented, Spinner } from "../ui";
import { initialState, reducer, type State } from "./state";
import { MajorPanel } from "../features/major/MajorPanel";
import { applyMajor, clearMajor, constraintsUsingMyMajor } from "../features/major/major";

const PROFILE_KEY = "profile.v1";

function errText(e: unknown): string {
  if (e instanceof ApiError) {
    const f = e.fields.length ? ` (${e.fields.slice(0, 4).map((x) => `${x.path}: ${x.reason}`).join(", ")})` : "";
    return `${e.message}${f} [${e.code}${e.status ? ` · HTTP ${e.status}` : ""}]`;
  }
  return "알 수 없는 오류가 발생했습니다.";
}

function reviewItemsOf(st: State) {
  return reviewItems({
    constraints: st.constraints,
    pending: st.nl.drafts,
    unsupported: st.nl.unsupported,
    majorTypeCategories: st.loaded?.majorTypeCategories ?? [],
    major: st.loaded?.major ?? null,
  });
}

function focusFirstReview() {
  const el = document.querySelector<HTMLElement>('[data-review-index="0"]');
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  (el.querySelector<HTMLElement>("input, select, textarea, button") ?? el).focus({ preventScroll: true });
}

export function App() {
  const [s, dispatch] = useReducer(reducer, initialState);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [capsError, setCapsError] = useState<string | null>(null);
  const [dataOpen, setDataOpen] = useState(false);
  const [tab, setTab] = useState<"conditions" | "results">("conditions");
  const [majorBusy, setMajorBusy] = useState(false);
  const [majorError, setMajorError] = useState<string | null>(null);
  const solveAbort = useRef<AbortController | null>(null);
  const parseSeq = useRef(0);

  useEffect(() => {
    const ac = new AbortController();
    api.capabilities(ac.signal).then(setCaps, (e) => (e as Error).name !== "AbortError" && setCapsError(errText(e)));
    return () => ac.abort();
  }, []);

  // 정규화된 이수내역만 로컬 저장(성적·학번·이름 없음).
  useEffect(() => {
    if (s.loaded) void storage.set(PROFILE_KEY, s.profile);
  }, [s.profile, s.loaded]);

  const catalog = s.loaded?.catalog ?? null;
  const eligibility = useMemo(() => (catalog ? computeEligibility(catalog, s.profile) : { allowed: [], excluded: [] }), [catalog, s.profile]);
  const items = reviewItemsOf(s);
  // 최신 렌더 상태(클릭 시점 스냅샷용). 상태 갱신 직후 이전 값을 읽지 않도록 이벤트에서 ref로 읽는다.
  const stateRef = useRef(s);
  stateRef.current = s;
  const inFlight = useRef(false);
  const solving = s.solve.phase === "solving";

  async function onCatalogLoaded(l: NonNullable<typeof s.loaded>) {
    dispatch({ type: "catalog_loaded", loaded: l });
    setDataOpen(false);
    const saved = await storage.get<ProfileEntry[]>(PROFILE_KEY);
    if (saved?.length) dispatch({ type: "profile_set", entries: rematchProfile(saved, l.catalog), dropped: [] });
  }

  /** 내 전공 기준 적용/해제: 분류만 바꾼 카탈로그를 서버가 다시 검증해 새 revision을 받는다(계약 변경 없음). */
  async function replaceCatalogForMajor(courseIds: string[] | null, orgs: string[] = [], types: string[] = []) {
    if (!s.loaded) return;
    setMajorBusy(true);
    setMajorError(null);
    const next = courseIds ? applyMajor(s.loaded.catalog, courseIds, types) : clearMajor(s.loaded.catalog);
    try {
      const v = await api.validateCatalog(next);
      if (!v.valid || !v.catalog || !v.catalog_revision) throw new Error(v.errors.map((e) => e.message).join(", "));
      dispatch({
        type: "catalog_replaced",
        loaded: {
          ...s.loaded,
          catalog: v.catalog as typeof next,
          revision: v.catalog_revision,
          major: courseIds ? { courseIds, orgs, types, confirmedAt: new Date().toISOString() } : null,
        },
        removeConstraintIds: courseIds ? [] : constraintsUsingMyMajor(s.constraints),
      });
    } catch (e) {
      setMajorError(e instanceof ApiError ? errText(e) : `내 전공 기준을 적용하지 못했어요: ${(e as Error).message}`);
    } finally {
      setMajorBusy(false);
    }
  }

  function buildRequest(constraints: Constraint[], revision: number): SolveRequest {
    return {
      schema_version: "1.0",
      catalog: catalog!,
      catalog_revision: s.loaded!.revision,
      allowed_section_ids: eligibility.allowed,
      constraints,
      confirmation: { input_revision: revision, confirmed_revision: revision },
      options: { max_candidates: 3, min_section_distance: 2, time_budget_ms: 3000 },
    };
  }

  async function runSolve(constraints = s.constraints, revision = s.revision, allowed = eligibility.allowed) {
    solveAbort.current?.abort();
    const ac = new AbortController();
    solveAbort.current = ac;
    inFlight.current = true;
    dispatch({ type: "solve_start" });
    setTab("results");
    try {
      const res = await api.solve({ ...buildRequest(constraints, revision), allowed_section_ids: allowed }, ac.signal);
      dispatch({ type: "solve_done", forRevision: res.input_revision, response: res });
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      dispatch({ type: "solve_error", forRevision: revision, error: errText(e) });
    } finally {
      if (solveAbort.current === ac) inFlight.current = false;
    }
  }

  /** '이 조건으로 시간표 만들기': 클릭 시점 상태 스냅샷을 다시 검사하고, 그 스냅샷으로 확정·생성 요청을 보낸다. */
  function generate() {
    const cur = stateRef.current;
    if (inFlight.current || cur.solve.phase === "solving" || !cur.loaded) return; // 중복 요청 방지
    if (reviewItemsOf(cur).length) return; // 확인할 조건이 남으면 /solve를 부르지 않는다
    const allowed = computeEligibility(cur.loaded.catalog, cur.profile).allowed;
    dispatch({ type: "confirm" }); // 이 revision의 조건을 사용자가 확정
    void runSolve(cur.constraints, cur.revision, allowed);
  }

  async function runDiagnose() {
    solveAbort.current?.abort();
    const ac = new AbortController();
    solveAbort.current = ac;
    const revision = s.revision;
    dispatch({ type: "diagnose_start" });
    try {
      const res = await api.diagnose({ ...buildRequest(s.constraints, revision), diagnosis_budget_ms: 5000 }, ac.signal);
      dispatch({ type: "diagnose_done", forRevision: res.input_revision, response: res });
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      dispatch({ type: "diagnose_error", forRevision: revision, error: errText(e) });
    }
  }

  function applyProposal(p: RelaxationProposal) {
    const changes = new Map(p.changes.map((c) => [c.constraint_id, c.after as unknown as Constraint]));
    const next = s.constraints.map((c) => changes.get(c.id) ?? c);
    dispatch({ type: "apply_proposal", constraints: next });
    // apply_proposal은 revision을 1 올리고 그 revision으로 확인한다.
    void runSolve(next, s.revision + 1);
  }

  async function runParse(text: string) {
    if (!catalog || !s.loaded) return;
    const seq = ++parseSeq.current;
    const revision = s.revision;
    dispatch({ type: "nl_start" });
    try {
      const res = await api.parse({
        schema_version: "1.0",
        text,
        catalog_revision: s.loaded.revision,
        input_revision: revision,
        entities: buildEntities(catalog),
        existing_constraints: s.constraints.map((c) => ({ id: c.id, type: c.type, label: describe(c, catalog).slice(0, 200) })),
      });
      if (seq !== parseSeq.current) return; // 오래된 해석 응답 무시
      dispatch({ type: "nl_done", forRevision: revision, response: res });
    } catch (e) {
      if (seq !== parseSeq.current) return;
      dispatch({ type: "nl_error", error: `${errText(e)} — 수동 조건 입력과 시간표 생성은 계속 사용할 수 있습니다.` });
    }
  }

  async function clearAll() {
    await storage.clearAll();
    dispatch({ type: "reset_all" });
  }

  const parseMode = caps?.parse_provider_mode ?? null;
  const notImplemented = caps ? Object.entries(caps.features).filter(([, v]) => v === "not_implemented").map(([k]) => k) : [];
  const resp = s.solve.response;
  const stepIndex = !catalog ? 0 : resp && resp.candidates.length ? 2 : 1;
  const steps = ["강좌 준비", "조건 설정", "시간표 비교"];

  const header = (
    <header className="topbar">
      <div className="brand">
        <h1>TimetableSolver</h1>
        <p>내 조건에 맞는 시간표를 찾아보세요.</p>
      </div>
      <div className="meta" aria-label="현재 데이터">
        {s.loaded ? (
          <>
            <Badge tone={s.loaded.source === "demo" ? "outline" : "primary"}>
              {s.loaded.source === "demo" ? "샘플 데이터" : s.loaded.catalog.sections.some((x) => x.support_status !== "supported") ? "학교 데이터 · 일부 제외" : "학교 데이터"}
            </Badge>
            <span>
              {s.loaded.catalog.term_id} 학기 · {s.loaded.fileName}
              {s.loaded.source === "school" && ` · 기준일 ${s.loaded.asOf ?? "미확인"}`}
            </span>
          </>
        ) : (
          <Badge tone="outline">강좌 데이터 없음</Badge>
        )}
      </div>
    </header>
  );

  const stepper = (
    <ol className="steps" aria-label="진행 단계">
      {steps.map((label, i) => (
        <li key={label} className={`step ${i === stepIndex ? "current" : i < stepIndex ? "done" : ""}`} aria-current={i === stepIndex ? "step" : undefined}>
          <span className="dot">{i < stepIndex ? <Icon name="check" size={13} /> : i + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );

  const footer = (
    <footer className="footer">
      {capsError && <p className="error">서버 기능 정보를 불러오지 못했어요: {capsError}</p>}
      {caps && (
        <p>
          자연어 해석: {parseMode === "fixture" ? "데모 모드(규칙 기반)" : parseMode === "live" ? "Gemini live" : "사용 불가"} · 이번 버전에서 구현하지 않은 기능: {notImplemented.join(", ")} · 지원하지 않는 조건 유형:{" "}
          {caps.unsupported_constraint_types.join(", ")}
        </p>
      )}
    </footer>
  );

  if (!s.loaded) {
    return (
      <div className="app">
        {header}
        {stepper}
        <CatalogPanel loaded={null} onLoaded={onCatalogLoaded} />
        {footer}
      </div>
    );
  }
  const cat = s.loaded.catalog;

  return (
    <div className="app">
      {header}
      {stepper}
      <div className="mobile-tabs">
        <Segmented
          label="화면 전환"
          value={tab}
          onChange={setTab}
          options={[
            { value: "conditions", label: "조건" },
            { value: "results", label: resp?.candidates.length ? `결과 · 후보 ${resp.candidates.length}` : "결과" },
          ]}
        />
      </div>
      <div className="layout" data-tab={tab}>
        <aside className="side" aria-label="조건 설정">
          <DataSummary loaded={s.loaded} onChange={() => setDataOpen(true)} />
          <MajorPanel
            loaded={s.loaded}
            busy={majorBusy}
            error={majorError}
            onApply={(ids, orgs, types) => void replaceCatalogForMajor(ids, orgs, types)}
            onClear={() => void replaceCatalogForMajor(null)}
          />
          <ProfilePanel
            catalog={cat}
            entries={s.profile}
            dropped={s.profileDropped}
            eligibility={eligibility}
            onSet={(entries, dropped) => dispatch({ type: "profile_set", entries, dropped })}
            onUpdate={(id, patch) => dispatch({ type: "profile_update", local_id: id, patch })}
            onClearAll={clearAll}
          />
          <Card tight aria-labelledby="cons-h">
            <NlPanel nl={s.nl} parseMode={parseMode} onParse={runParse} onGoReview={() => focusFirstReview()} />
            <hr className="divider" />
            <div className="row between" style={{ marginBottom: 12 }}>
              <h3 id="cons-h">내 조건 · 반영 완료 {s.constraints.length}개</h3>
              {items.length > 0 && <span className="badge warning">확인 필요 {items.length}개 · 아래에서</span>}
            </div>
            <ConstraintList
              constraints={s.constraints}
              catalog={cat}
              meta={s.meta}
              excluded={s.nl.unsupported.filter((u) => u.excluded)}
              onRemove={(id) => dispatch({ type: "constraint_remove", id })}
              onReplace={(constraint) => dispatch({ type: "constraint_replace", constraint })}
            />
            <details style={{ marginTop: 12 }}>
              <summary data-testid="add-toggle">
                <Icon name="plus" /> 직접 조건 추가
              </summary>
              <div style={{ marginTop: 12 }}>
                <ConstraintForm catalog={cat} onAdd={(constraint) => dispatch({ type: "constraint_add", constraint })} />
              </div>
            </details>
          </Card>
          <Card tight aria-label="시간표 만들기" data-testid="action-card">
            <div className="stack">
              <p className="small muted">
                수강 가능 분반 <b className="num">{eligibility.allowed.length}</b>개
              </p>
              {eligibility.allowed.length === 0 && <p className="reason">수강 가능 분반이 0개라 결과는 불가능이 됩니다.</p>}
              <ReviewPanel
                catalog={cat}
                items={items}
                constraints={s.constraints}
                meta={s.meta}
                generating={solving}
                blockedReason={null}
                onGenerate={generate}
                handlers={{
                  applyDraft: (draftId, draft) => dispatch({ type: "review_apply", draftId, draft }),
                  discardDraft: (draftId) => dispatch({ type: "review_discard", draftId }),
                  resolveConflict: (draftId, mode, params) => dispatch({ type: "conflict_resolve", draftId, mode, params }),
                  excludeUnsupported: (index) => dispatch({ type: "nl_ack", index }),
                  addConstraint: (constraint) => dispatch({ type: "constraint_add", constraint }),
                  replaceConstraint: (constraint) => dispatch({ type: "constraint_replace", constraint }),
                  removeConstraints: (ids) => ids.forEach((id) => dispatch({ type: "constraint_remove", id })),
                  openMajor: () => window.dispatchEvent(new CustomEvent("open-major-panel")),
                }}
              />
            </div>
          </Card>
        </aside>

        <main className="main" aria-label="시간표 결과">
          {dataOpen && <CatalogPanel loaded={s.loaded} onLoaded={onCatalogLoaded} onCancel={() => setDataOpen(false)} />}
          <Card>
            {s.solve.phase === "idle" && !resp && (
              <div className="empty" data-testid="results-empty">
                <h3>아직 만든 시간표가 없어요</h3>
                {items.length > 0 ? (
                  <>
                    <p className="small">
                      확인할 조건이 <b>{items.length}개</b> 남았어요. 확인을 마치면 ‘이 조건으로 시간표 만들기’로 바로 만들 수 있어요.
                    </p>
                    <div style={{ marginTop: 12 }}>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setTab("conditions");
                          requestAnimationFrame(() => focusFirstReview());
                        }}
                        data-testid="empty-go-review"
                      >
                        확인할 조건으로 이동
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="small">조건 요약을 확인하고 ‘이 조건으로 시간표 만들기’를 누르면 여기에 후보가 나와요.</p>
                )}
              </div>
            )}
            {solving && (
              <div className="row between">
                <Spinner label="시간표를 계산하고 있어요" />
                <Button variant="secondary" size="sm" onClick={() => solveAbort.current?.abort()}>
                  취소
                </Button>
              </div>
            )}
            {s.solve.phase === "error" && (
              <div data-testid="solve-error">
                <Alert tone="danger" title="시간표 계산 요청이 실패했어요 (조건이 불가능하다는 뜻은 아니에요)">
                  {s.solve.error}
                </Alert>
              </div>
            )}
            {resp && resp.status === "infeasible" && (
              <div className="stack" data-testid="infeasible">
                <Alert tone="danger" title="이 조건들을 함께 만족하는 시간표를 찾을 수 없어요">
                  확인한 꼭 지키기 조건을 모두 만족하는 조합이 없음이 증명됐어요. 조건은 자동으로 바꾸지 않습니다.
                </Alert>
                {s.diagnosis.phase !== "done" &&
                  (s.diagnosis.phase === "solving" ? (
                    <Spinner label="어떤 조건이 부딪히는지 찾고 있어요" />
                  ) : (
                    <div>
                      <Button onClick={runDiagnose} data-testid="diagnose">
                        부딪히는 조건 찾기
                      </Button>
                    </div>
                  ))}
                {s.diagnosis.phase === "error" && <Alert tone="danger" title="진단 요청이 실패했어요">{s.diagnosis.error}</Alert>}
                {s.diagnosis.response && <DiagnosisPanel catalog={cat} constraints={s.constraints} response={s.diagnosis.response} onApply={applyProposal} />}
              </div>
            )}
            {resp && resp.status === "unknown" && (
              <div data-testid="unknown">
                <Alert tone="warning" title="시간 안에 결과를 확인하지 못했어요">
                  해를 찾지도, 불가능을 증명하지도 못했어요(불가능 판정이 아닙니다). 조건을 줄이거나 다시 시도해 주세요.
                </Alert>
              </div>
            )}
            {resp && resp.candidates.length > 0 && (
              <ResultsPanel catalog={cat} response={resp} selected={s.solve.selected} constraints={s.constraints} onSelect={(index) => dispatch({ type: "select_candidate", index })} />
            )}
          </Card>
        </main>
      </div>
      {footer}
    </div>
  );
}
