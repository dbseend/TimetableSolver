/**
 * 기본 시작 화면: 학기 선택 → 학교 강좌로 시작하기.
 * 관리자가 변환해 둔 기본 학교 카탈로그를 서버에서 받는다(업로드와 같은 서버 검증·같은 솔버). 파일 업로드가 필요 없다.
 */
import { useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api";
import type { LoadedCatalog } from "../../app/state";
import type { Catalog, DefaultCatalogSummary } from "../../lib/types";
import { Alert, Badge, Button } from "../../ui";
import type { ImportIssue } from "./adapter";
import { SECTION_ISSUE_LABEL } from "./issueLabels";

type ListState = { status: "loading" } | { status: "ready"; items: DefaultCatalogSummary[] } | { status: "error"; message: string };

export function SchoolStart({ onLoaded }: { onLoaded: (l: LoadedCatalog) => void }) {
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [selected, setSelected] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    api.listCatalogs(ac.signal).then(
      (r) => {
        const items = r.catalogs.filter((c) => c.valid);
        setList({ status: "ready", items });
        if (items[0]) setSelected(items[0].id);
      },
      (e) => (e as Error).name !== "AbortError" && setList({ status: "error", message: e instanceof ApiError ? e.message : "학교 데이터 목록을 불러오지 못했어요." }),
    );
    return () => ac.abort();
  }, []);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.getCatalog(selected);
      onLoaded({
        catalog: r.catalog as Catalog,
        revision: r.catalog_revision,
        source: "school",
        fileName: r.summary.label,
        asOf: r.summary.as_of,
        issues: r.import_issues as unknown as ImportIssue[],
        serverWarnings: [],
        courseOrgs: r.course_orgs,
        majorTypeCategories: r.major_type_categories,
        major: null,
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "학교 데이터를 불러오지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  if (list.status === "loading") return <p className="muted small">학교 데이터를 확인하고 있어요…</p>;
  if (list.status === "error")
    return (
      <Alert tone="danger" title="학교 데이터 목록을 불러오지 못했어요">
        {list.message} 아래 다른 방법으로 시작할 수 있어요.
      </Alert>
    );
  if (!list.items.length)
    return (
      <div data-testid="school-unavailable">
        <Alert tone="info" title="기본 학교 데이터가 아직 준비되지 않았어요">
          관리자가 학기 개설강좌를 변환해 두면 여기서 바로 시작할 수 있어요. 지금은 아래 다른 방법으로 시작해 주세요.
        </Alert>
      </div>
    );

  const cur = list.items.find((c) => c.id === selected) ?? list.items[0];
  const s = cur.stats;
  return (
    <div className="choice" data-testid="school-start" style={{ borderColor: "var(--primary)" }}>
      <div className="row between">
        <h3>학교 강좌로 시작하기</h3>
        <Badge tone="primary">권장</Badge>
      </div>
      <label className="field" style={{ maxWidth: 360 }}>
        학기
        <select value={cur.id} onChange={(e) => setSelected(e.target.value)} data-testid="school-term">
          {list.items.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label} ({c.term_id})
            </option>
          ))}
        </select>
      </label>
      <dl className="data-facts" data-testid="school-facts">
        <div>
          <dt>데이터 기준일</dt>
          <dd className="num" style={{ fontSize: 16 }}>
            {cur.as_of ?? "미확인"}
          </dd>
        </div>
        <div>
          <dt>시간표에 쓰는 분반</dt>
          <dd>
            {s.supported_sections}
            <span className="small muted"> / {s.sections}</span>
          </dd>
        </div>
        <div>
          <dt>제외 분반</dt>
          <dd>{s.unsupported_sections}</dd>
        </div>
      </dl>
      {(s.unsupported_sections > 0 || cur.excluded_courses > 0) && (
        <div>
          <h4>제외 사유</h4>
          <ul className="reason-list" data-testid="school-exclusions">
            {Object.entries(cur.exclusion_reasons)
              .sort((a, b) => b[1] - a[1])
              .map(([code, n]) => (
                <li key={code}>
                  <span>{SECTION_ISSUE_LABEL[code] ?? code}</span>
                  <span className="num strong">{n}분반</span>
                </li>
              ))}
            {cur.excluded_courses > 0 && (
              <li>
                <span>과목명이 행마다 달라 제외한 과목</span>
                <span className="num strong">{cur.excluded_courses}과목</span>
              </li>
            )}
          </ul>
        </div>
      )}
      <p className="xs muted">
        과목 {s.courses}개 · 원본 {cur.source_file ?? "-"} · {cur.period_table_basis ?? "교시표 기준 미기재"}
      </p>
      <div>
        <Button onClick={start} disabled={busy} data-testid="start-school">
          {busy ? "불러오는 중…" : "학교 강좌로 시작하기"}
        </Button>
      </div>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
