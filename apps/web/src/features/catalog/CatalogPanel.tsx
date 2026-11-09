import { useRef, useState } from "react";
import { Alert, Badge, Button, Card, Icon } from "../../ui";
import demoCsv from "../../../../../fixtures/catalogs/demo-campus-2026-2.csv?raw";
import { api, ApiError } from "../../lib/api";
import type { LoadedCatalog } from "../../app/state";
import type { Catalog } from "../../lib/types";
import { parseDelimited } from "./csv";
import { decodeTableFile, looksLikeHtml, parseHtmlTable } from "./htmlTable";
import { SECTION_ISSUE_LABEL } from "./issueLabels";
import { SchoolStart } from "./SchoolStart";
import { matchesPortalExport, PORTAL_ADAPTER_BASE, PORTAL_MAJOR_TYPE_CATEGORIES, PORTAL_PERIOD_TABLE_TEXT } from "./presets";
import {
  type AdapterConfig,
  DEFAULT_CATEGORY_MAP,
  DEMO_ADAPTER,
  EXAMPLE_PERIOD_TABLE,
  FIELD_LABELS,
  type FieldKey,
  formatPeriodTable,
  guessColumns,
  guessTimeMode,
  type ImportIssue,
  importCatalog,
  parsePeriodTables,
  type TimeMode,
} from "./adapter";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 10000;

/** 어댑터 결과 → 서버 검증(/catalog/validate) → 서버가 정규화한 Catalog와 revision을 그대로 사용한다. */
async function finalize(
  rows: string[][],
  cfg: AdapterConfig,
  source: "demo" | "upload",
  fileName: string,
  majorTypeCategories: string[] = [],
): Promise<LoadedCatalog | { issues: ImportIssue[] }> {
  const res = importCatalog(rows, cfg);
  if (!res.catalog) return { issues: res.issues };
  try {
    const v = await api.validateCatalog(res.catalog);
    if (!v.valid || !v.catalog || !v.catalog_revision) {
      return { issues: [...res.issues, ...v.errors.map((e) => ({ severity: "error" as const, row: null, code: e.code, message: `${e.path}: ${e.message}` }))] };
    }
    return {
      catalog: v.catalog as Catalog,
      revision: v.catalog_revision,
      source,
      fileName,
      issues: res.issues,
      serverWarnings: v.warnings.map((w) => `${w.path}: ${w.message}`),
      courseOrgs: res.courseOrgs,
      majorTypeCategories,
      major: null,
    };
  } catch (e) {
    const msg = e instanceof ApiError ? `${e.message}${e.fields.length ? " — " + e.fields.slice(0, 5).map((f) => `${f.path}:${f.reason}`).join(", ") : ""}` : String(e);
    return { issues: [...res.issues, { severity: "error", row: null, code: "SERVER_VALIDATION", message: msg }] };
  }
}

interface Upload {
  fileName: string;
  rows: string[][];
  cfg: AdapterConfig;
  periodText: string;
  categoryLabels: string[];
  majorLabels: Set<string>;
  encoding: string;
  detected: "portal" | null;
  /** 교시 표기 방식일 때 사용자가 교시표를 학교 기준으로 확인했는지(예시값을 실제처럼 쓰지 않기 위함) */
  periodConfirmed: boolean;
}

/** 데이터 준비 화면(메인 영역). 카탈로그가 없거나 사용자가 '바꾸기'를 눌렀을 때 표시한다. */
export function CatalogPanel({ loaded, onLoaded, onCancel }: { loaded: LoadedCatalog | null; onLoaded: (l: LoadedCatalog) => void; onCancel?: () => void }) {
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<ImportIssue[]>([]);
  const [upload, setUpload] = useState<Upload | null>(null);

  async function run(rows: string[][], cfg: AdapterConfig, source: "demo" | "upload", fileName: string, majorTypes: string[] = []) {
    setBusy(true);
    setIssues([]);
    const out = await finalize(rows, cfg, source, fileName, majorTypes);
    setBusy(false);
    if ("catalog" in out) {
      onLoaded(out);
      setUpload(null);
    } else setIssues(out.issues);
  }

  async function onFile(f: File) {
    setIssues([]);
    if (f.size > MAX_FILE_BYTES) return setIssues([{ severity: "error", row: null, code: "FILE_TOO_LARGE", message: "파일이 5 MiB를 넘습니다." }]);
    if (!/\.(csv|tsv|txt|xls|htm|html)$/i.test(f.name))
      return setIssues([{ severity: "error", row: null, code: "UNSUPPORTED_FORMAT", message: "CSV/TSV 또는 포털에서 내려받은 HTML 표(.xls)만 지원합니다. 엑셀 이진·xlsx는 'CSV UTF-8'로 저장해 올려 주세요." }]);
    const dec = decodeTableFile(await f.arrayBuffer());
    if ("error" in dec) return setIssues([{ severity: "error", row: null, code: "ENCODING", message: dec.error }]);
    const rows = looksLikeHtml(dec.text) ? parseHtmlTable(dec.text) : parseDelimited(dec.text);
    if (rows.length > MAX_ROWS + 1) return setIssues([{ severity: "error", row: null, code: "TOO_MANY_ROWS", message: `행이 ${MAX_ROWS}개를 넘습니다.` }]);
    if (rows.length < 2) return setIssues([{ severity: "error", row: null, code: "EMPTY_FILE", message: "데이터 행이 없습니다." }]);
    const headers = rows[0].map((h) => h.trim());
    const portal = matchesPortalExport(headers);
    const columns = portal ? { ...PORTAL_ADAPTER_BASE.columns } : guessColumns(headers);
    const catCol = columns.category ? headers.indexOf(columns.category) : -1;
    const categoryLabels = catCol < 0 ? [] : [...new Set(rows.slice(1).map((r) => (r[catCol] ?? "").trim()).filter(Boolean))].sort();
    const categoryMap: Record<string, string> = {};
    for (const l of categoryLabels) categoryMap[l] = portal ? l : (DEFAULT_CATEGORY_MAP[l] ?? l);
    const majorLabels = new Set(
      portal ? categoryLabels.filter((l) => PORTAL_MAJOR_TYPE_CATEGORIES.includes(l)) : categoryLabels.filter((l) => l.includes("전공") || l === "전필" || l === "전선"),
    );
    const timeMode = portal ? PORTAL_ADAPTER_BASE.timeMode : guessTimeMode(columns);
    setUpload({
      fileName: f.name,
      rows,
      categoryLabels,
      majorLabels,
      encoding: dec.encoding,
      detected: portal ? "portal" : null,
      periodConfirmed: false,
      periodText: portal ? PORTAL_PERIOD_TABLE_TEXT : formatPeriodTable(EXAMPLE_PERIOD_TABLE),
      cfg: {
        catalogId: f.name.replace(/\.[^.]+$/, "").slice(0, 60) || "uploaded",
        termId: "",
        dataOrigin: "user_import",
        columns,
        lines: portal ? { ...PORTAL_ADAPTER_BASE.lines } : {},
        timeMode,
        periodTable: EXAMPLE_PERIOD_TABLE,
        categoryMap,
        categoryGroups: {},
        defaultDelivery: columns.delivery_mode ? null : "in_person",
      },
    });
  }

  function submitUpload() {
    if (!upload) return;
    const { common, byDay, errors } = parsePeriodTables(upload.periodText);
    const usesPeriods = upload.cfg.timeMode !== "day_start_end";
    if (usesPeriods && errors.length) return setIssues([{ severity: "error", row: null, code: "PERIOD_TABLE", message: `교시표 형식 오류: ${errors.join(" | ")}` }]);
    if (usesPeriods && !upload.periodConfirmed)
      return setIssues([{ severity: "error", row: null, code: "PERIOD_TABLE_UNCONFIRMED", message: upload.detected === "portal" ? "교시표가 학교 공지와 같은지 확인하고 체크해 주세요." : "교시표가 학교 공지와 같은지 확인하고 체크해 주세요. 예시값을 실제 시간으로 쓰지 않습니다." }]);
    // '전공 유형' 이수구분은 그룹으로 만들지 않는다(내 전공 인정 기준이 확인되지 않음). 사이드의 '내 전공 과목'에서 따로 확인한다.
    const majorTypes = [...new Set([...upload.majorLabels].map((l) => upload.cfg.categoryMap[l] ?? l))];
    const cfg: AdapterConfig = { ...upload.cfg, periodTable: common, periodTableByDay: byDay, categoryGroups: {} };
    void run(upload.rows, cfg, "upload", upload.fileName, majorTypes);
  }

  const setCfg = (patch: Partial<AdapterConfig>) => upload && setUpload({ ...upload, cfg: { ...upload.cfg, ...patch } });
  const headers = upload?.rows[0].map((h) => h.trim()) ?? [];
  // 셀 안에 줄바꿈이 있는 열(예: 과목명 한글/영문, 개설정보 학부/교수)은 사용할 줄을 고르게 한다.
  const multilineCols = new Set(headers.filter((_, i) => upload?.rows.slice(1, 200).some((r) => (r[i] ?? "").includes("\n"))));
  const fieldsForMode = (m: TimeMode): FieldKey[] => {
    const base: FieldKey[] = ["course_code", "course_name", "section", "credit", "category", "instructor_id", "instructor", "delivery_mode"];
    const time: FieldKey[] = m === "day_start_end" ? ["day", "start", "end"] : m === "day_period" ? ["day", "period"] : ["schedule"];
    return [...base, ...time, "room", "schedule_note"];
  };

  return (
    <Card aria-labelledby="catalog-h" data-testid="data-prep">
      <div className="card-head">
        <div>
          <h2 id="catalog-h">강좌 준비</h2>
          <p>학기를 고르고 학교 강좌로 시작하세요. 파일을 올릴 필요가 없어요.</p>
        </div>
        {loaded && onCancel && (
          <Button variant="secondary" size="sm" onClick={onCancel} data-testid="keep-data">
            ← 조건 설정으로 돌아가기(현재 데이터 유지)
          </Button>
        )}
      </div>

      {!upload && <SchoolStart onLoaded={onLoaded} />}

      {!upload && (
        <h3 className="muted" style={{ margin: "24px 0 12px", fontSize: 15 }}>
          다른 방법으로 시작
        </h3>
      )}
      {!upload && (
        <div className="onboard">
          <div className="choice">
            <h3>샘플로 체험하기 (보조)</h3>
            <p>가상 학교의 합성 개설강좌(32개 분반)로 바로 시작합니다. 실제 학교 자료가 아닙니다.</p>
            <div>
              <Button variant="secondary" onClick={() => run(parseDelimited(demoCsv), DEMO_ADAPTER, "demo", "demo-campus-2026-2.csv")} disabled={busy} data-testid="load-demo">
                샘플로 체험하기
              </Button>
            </div>
          </div>
          <div className="choice">
            <h3>개설강좌 파일 직접 올리기 (데이터 갱신·개별 파일용)</h3>
            <div
              className={`drop ${dragOver ? "over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void onFile(f);
              }}
            >
              <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
                <Icon name="upload" /> 파일 선택
              </Button>
              <p>또는 파일을 여기로 끌어다 놓으세요</p>
              <p className="xs">CSV·TSV(UTF-8), 학사 포털에서 내려받은 HTML 표(.xls, EUC-KR 가능) · 최대 5 MiB · 10,000행</p>
              <input
                ref={fileRef}
                className="sr-only"
                type="file"
                accept=".csv,.tsv,.txt,.xls,.htm,.html"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void onFile(f);
                }}
                data-testid="catalog-file"
                aria-label="개설강좌 파일 선택"
              />
            </div>
          </div>
        </div>
      )}
      {busy && (
        <p className="muted small" role="status">
          변환하고 서버에서 검증하고 있어요…
        </p>
      )}

      {upload && (
        <div className="section-gap" data-testid="mapping">
          <div className="row between">
            <div>
              <h3>{upload.fileName}</h3>
              <p className="small muted" data-testid="upload-meta">
                인코딩 {upload.encoding} · 데이터 {upload.rows.length - 1}행 · 아직 가져오지 않았습니다
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setUpload(null)}>
              다른 파일 고르기
            </Button>
          </div>
          {upload.detected === "portal" && (
            <Alert tone="success" testId="portal-detected" title="포털 내보내기 형식을 인식했어요">
              열·셀 줄·요일별 교시표를 채웠습니다. 학기 ID와 교시표를 학교 공지와 대조해 확인해 주세요.
            </Alert>
          )}

          <div className="form-grid">
            <label className="field">
              학기 ID (필수)
              <input value={upload.cfg.termId} placeholder="예: 2026-2" onChange={(e) => setCfg({ termId: e.target.value })} data-testid="term-id" />
            </label>
            <label className="field">
              카탈로그 이름
              <input value={upload.cfg.catalogId} onChange={(e) => setCfg({ catalogId: e.target.value })} />
            </label>
            <label className="field">
              시간 표기 방식
              <select value={upload.cfg.timeMode} onChange={(e) => setCfg({ timeMode: e.target.value as TimeMode })} data-testid="time-mode">
                <option value="day_start_end">요일 + 시작/종료 시각</option>
                <option value="day_period">요일 + 교시</option>
                <option value="schedule_text">한 칸 강의시간 (예: 월1-2,수3)</option>
              </select>
            </label>
            <label className="field">
              수업방식 열이 없을 때
              <select
                value={upload.cfg.defaultDelivery ?? ""}
                onChange={(e) => setCfg({ defaultDelivery: (e.target.value || null) as AdapterConfig["defaultDelivery"] })}
              >
                <option value="">수업방식 열 사용</option>
                <option value="in_person">모두 대면으로 간주</option>
              </select>
            </label>
          </div>

          {upload.cfg.timeMode !== "day_start_end" && (
            <div className="stack">
              <label className="field" htmlFor="period-table">
                교시표 (`교시=시작-종료`, 요일마다 다르면 `[월,화,목,금]`·`[수]` 머리글)
              </label>
              {upload.detected !== "portal" ? (
                <Alert tone="warning" title="아래 교시표는 예시값이에요">
                  학교 공지의 교시표로 바꾼 뒤 확인해 주세요. 표가 없는 요일의 교시는 추정하지 않고 제외합니다.
                </Alert>
              ) : (
                <p className="small muted">토·일 교시 시간은 자료에 없어 넣지 않았습니다. 해당 분반은 제외됩니다.</p>
              )}
              <textarea
                id="period-table"
                rows={8}
                value={upload.periodText}
                onChange={(e) => setUpload({ ...upload, periodText: e.target.value, periodConfirmed: false })}
                data-testid="period-table"
              />
              <label className="check">
                <input type="checkbox" checked={upload.periodConfirmed} onChange={(e) => setUpload({ ...upload, periodConfirmed: e.target.checked })} data-testid="period-confirm" />
                이 교시표가 학교 공지와 같음을 확인했습니다
              </label>
            </div>
          )}

          <details>
            <summary>열 매핑 확인 ({Object.values(upload.cfg.columns).filter(Boolean).length}개 연결됨)</summary>
            <div className="map-grid" style={{ marginTop: 12 }}>
              {fieldsForMode(upload.cfg.timeMode).map((k) => (
                <div key={k} className="map-item">
                  <span className="lbl">{FIELD_LABELS[k]}</span>
                  <div className="ctl">
                    <select
                      aria-label={`${FIELD_LABELS[k]} 원본 열`}
                      value={upload.cfg.columns[k] ?? ""}
                      onChange={(e) => setCfg({ columns: { ...upload.cfg.columns, [k]: e.target.value || undefined } })}
                      data-testid={`map-${k}`}
                    >
                      <option value="">(없음)</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                    {multilineCols.has(upload.cfg.columns[k] ?? "") && (
                      <select
                        aria-label={`${FIELD_LABELS[k]} 사용할 줄`}
                        value={upload.cfg.lines?.[k] ?? ""}
                        onChange={(e) => {
                          const lines = { ...(upload.cfg.lines ?? {}) };
                          if (e.target.value === "") delete lines[k];
                          else lines[k] = Number(e.target.value);
                          setCfg({ lines });
                        }}
                        data-testid={`line-${k}`}
                      >
                        <option value="">줄 전체</option>
                        <option value="0">1번째 줄</option>
                        <option value="1">2번째 줄</option>
                        <option value="2">3번째 줄</option>
                      </select>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </details>

          {upload.categoryLabels.length > 0 && (
            <details>
              <summary>이수구분 매핑 · 전공 유형 ({upload.majorLabels.size}개 구분)</summary>
              <div className="table-scroll" style={{ marginTop: 12 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>원본 이수구분</th>
                      <th>category id</th>
                      <th>전공 유형</th>
                    </tr>
                  </thead>
                  <tbody>
                    {upload.categoryLabels.map((l) => (
                      <tr key={l}>
                        <td>{l}</td>
                        <td>
                          <input
                            aria-label={`${l} category id`}
                            value={upload.cfg.categoryMap[l] ?? l}
                            onChange={(e) => setCfg({ categoryMap: { ...upload.cfg.categoryMap, [l]: e.target.value } })}
                          />
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`${l}을(를) 전공 유형으로 표시`}
                            checked={upload.majorLabels.has(l)}
                            onChange={(e) => {
                              const m = new Set(upload.majorLabels);
                              if (e.target.checked) m.add(l);
                              else m.delete(l);
                              setUpload({ ...upload, majorLabels: m });
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="small muted" style={{ marginTop: 8 }}>
                전공 유형은 이수구분 표시일 뿐이에요. 학부와 관계없이 모든 과목에 붙어 있어 내 전공 학점으로 바로 쓰지 않습니다. 가져온 뒤 ‘내 전공 과목 정하기’에서 과목을 확인해야 내 전공 최소 학점 조건을 쓸 수 있어요.
              </p>
            </details>
          )}

          <div className="row">
            <Button onClick={submitUpload} disabled={busy} data-testid="import-submit">
              변환하고 검증하기
            </Button>
          </div>
        </div>
      )}
      {issues.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <IssueList issues={issues} testId="import-issues" />
        </div>
      )}
    </Card>
  );
}

const ISSUE_HINT: Record<string, string> = {
  REQUIRED_COLUMN_UNMAPPED: "열 매핑에서 해당 항목에 원본 열을 연결하세요.",
  MISSING_TERM: "학기 ID를 입력하세요.",
  PERIOD_TABLE: "형식을 `1=09:00-10:15`처럼 고치세요.",
  PERIOD_TABLE_UNCONFIRMED: "학교 공지와 대조한 뒤 확인란을 체크하세요.",
  COURSE_INCONSISTENT: "학교 자료에서 과목 정보를 확인하세요. 자동으로 합치지 않습니다.",
  CREDIT_INVALID: "학점은 0.01 단위 숫자여야 합니다.",
  ENCODING: "엑셀에서 'CSV UTF-8'로 다시 저장하세요.",
  UNSUPPORTED_FORMAT: "CSV UTF-8로 저장해 올리세요.",
  ROW_MISSING_KEY: "과목코드·과목명·분반이 비어 있지 않은지 확인하세요.",
  SECTION_UNSUPPORTED: "학교 자료에서 시간을 확인할 수 있으면 파일을 고쳐 다시 올리세요.",
};


function IssueList({ issues, testId }: { issues: ImportIssue[]; testId?: string }) {
  return (
    <ul className="issues" data-testid={testId}>
      {issues.slice(0, 200).map((i, k) => (
        <li key={k} className={i.severity}>
          <span className="tag">
            {i.severity === "error" ? "오류" : "경고"}
            {i.row !== null ? ` · ${i.row}행` : ""}
          </span>
          <span>
            {i.message}
            {ISSUE_HINT[i.code] && <span className="muted"> — {ISSUE_HINT[i.code]}</span>}
          </span>
        </li>
      ))}
      {issues.length > 200 && <li>…외 {issues.length - 200}건</li>}
    </ul>
  );
}

/** 사이드 패널의 데이터 요약. 반드시 알아야 할 제외 사실은 접지 않고 보여 준다. */
export function DataSummary({ loaded, onChange }: { loaded: LoadedCatalog; onChange: () => void }) {
  const c = loaded.catalog;
  const unsupported = c.sections.filter((s) => s.support_status !== "supported");
  const reasons: Record<string, number> = {};
  for (const s of unsupported) for (const code of s.issue_codes) reasons[code] = (reasons[code] ?? 0) + 1;
  const excludedCourses = loaded.issues.filter((i) => i.severity === "error" && (i.code === "COURSE_INCONSISTENT" || i.code === "CREDIT_INVALID"));
  const detailIssues = [...loaded.issues, ...loaded.serverWarnings.map((m) => ({ severity: "warning" as const, row: null, code: "SERVER", message: m }))];
  return (
    <Card tight aria-labelledby="data-h">
      <div className="row between">
        <h3 id="data-h">강좌 데이터</h3>
        <Button variant="ghost" size="sm" onClick={onChange}>
          바꾸기
        </Button>
      </div>
      <p className="small" data-testid="catalog-status" style={{ marginTop: 6 }}>
        <Badge tone={loaded.source === "demo" ? "outline" : "primary"}>
          {loaded.source === "demo" ? "합성 샘플" : loaded.source === "school" ? "학교 데이터 · 기본 제공" : "학교 데이터 · 업로드"}
        </Badge>{" "}
        <b>{loaded.source === "school" ? loaded.fileName : c.catalog_id}</b> · 학기 {c.term_id}
        {loaded.source === "school" && <> · 기준일 {loaded.asOf ?? "미확인"}</>} · 과목 {c.courses.length} · 분반 {c.sections.length} (미지원 {unsupported.length})
      </p>
      <dl className="data-facts">
        <div>
          <dt>과목</dt>
          <dd>{c.courses.length}</dd>
        </div>
        <div>
          <dt>가능 분반</dt>
          <dd>{c.sections.length - unsupported.length}</dd>
        </div>
        <div>
          <dt>제외 분반</dt>
          <dd>{unsupported.length}</dd>
        </div>
      </dl>
      {(unsupported.length > 0 || excludedCourses.length > 0) && (
        <div style={{ marginTop: 12 }}>
          <h4>시간표 생성에서 제외한 항목</h4>
          <ul className="reason-list" data-testid="exclusion-reasons">
            {Object.entries(reasons)
              .sort((a, b) => b[1] - a[1])
              .map(([code, n]) => (
                <li key={code}>
                  <span>{SECTION_ISSUE_LABEL[code] ?? code}</span>
                  <span className="num strong">{n}분반</span>
                </li>
              ))}
            {excludedCourses.length > 0 && (
              <li>
                <span>분반마다 학점·이수구분이 다른 과목(자동 병합 안 함)</span>
                <span className="num strong">{excludedCourses.length}과목</span>
              </li>
            )}
          </ul>
        </div>
      )}
      {loaded.source !== "demo" && unsupported.length + excludedCourses.length > 0 && (
        <p className="xs muted" style={{ marginTop: 10 }} data-testid="partial-support">
          학교 강좌 전체를 지원하지 않아요. 위 항목은 시간표 후보에 나오지 않습니다.
        </p>
      )}
      {detailIssues.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary>가져오기 경고·오류 {detailIssues.length}건 자세히</summary>
          <IssueList issues={detailIssues} />
        </details>
      )}
    </Card>
  );
}
