import { useState } from "react";
import demoTranscript from "../../../../../fixtures/profile/demo-transcript.tsv?raw";
import type { Catalog } from "../../lib/types";
import { decodeStrict } from "../catalog/csv";
import type { Eligibility } from "./eligibility";
import { excludesCourse } from "./eligibility";
import { type ProfileEntry, parseTranscript } from "./transcript";
import { Badge, Button, Card } from "../../ui";

const STATUS_KO: Record<ProfileEntry["completion_status"], string> = {
  completed: "이수",
  in_progress: "수강 중",
  not_completed: "미이수",
  unknown: "확인 필요",
};

interface Props {
  catalog: Catalog;
  entries: ProfileEntry[];
  dropped: string[];
  eligibility: Eligibility;
  onSet: (entries: ProfileEntry[], dropped: string[]) => void;
  onUpdate: (id: string, patch: Partial<ProfileEntry>) => void;
  onClearAll: () => void;
}

export function ProfilePanel({ catalog, entries, dropped, eligibility, onSet, onUpdate, onClearAll }: Props) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  function load(raw: string) {
    setError(null);
    const r = parseTranscript(raw, catalog);
    if (!r.entries.length) return setError("이수내역 행을 읽지 못했습니다. 헤더(과목코드/과목명/학점/이수학기/성적)를 확인하세요.");
    // 원문은 즉시 폐기: 입력창도 비운다. 정규화된 항목만 상태·로컬 저장소에 남는다.
    setText("");
    onSet(r.entries, r.droppedColumns);
  }

  const excludedCount = eligibility.excluded.filter((e) => e.reason.startsWith("이미")).length;
  return (
    <Card tight aria-labelledby="profile-h">
      <details open={open || entries.length > 0} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary id="profile-h" data-testid="profile-toggle">
        이수내역 <span className="muted">(선택)</span> {entries.length > 0 && <Badge tone="primary">{entries.length}과목 반영</Badge>}
      </summary>
      <p className="small muted" style={{ margin: "8px 0 12px" }}>
        이 브라우저에서만 처리해요. 학번·이름·성적 열은 읽은 직후 버리고, 서버에는 계산된 수강 가능 분반 ID만 보냅니다. 선수과목 규칙은 학교 자료가 없어 판정하지 않습니다.
      </p>
      {!entries.length && (
        <>
          <label className="field" htmlFor="transcript-input">
            이수내역 표 붙여넣기 (TSV/CSV, 머리글 포함)
          </label>
          <textarea
            id="transcript-input"
            rows={3}
            placeholder="과목코드  과목명  학점  이수학기  성적"
            value={text}
            onChange={(e) => setText(e.target.value)}
            data-testid="transcript-input"
          />
          <div className="row">
            <Button size="sm" onClick={() => load(text)} disabled={!text.trim()}>
              로컬에서 처리
            </Button>
            <label className="btn btn-secondary btn-sm">
              파일 선택
              <input
                type="file"
                className="sr-only"
                accept=".csv,.tsv,.txt"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const t = decodeStrict(await f.arrayBuffer());
                  if (t === null) setError("UTF-8로 읽을 수 없습니다.");
                  else load(t);
                }}
              />
            </label>
            <Button size="sm" variant="ghost" onClick={() => load(demoTranscript)} data-testid="load-demo-transcript">
              샘플 이수내역(가상)
            </Button>
          </div>
        </>
      )}
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      {entries.length > 0 && (
        <>
          <p className="small" data-testid="profile-summary" style={{ marginBottom: 8 }}>
            {entries.length}개 과목 · 추천 제외 분반 {excludedCount}개 · 수강 가능 분반 {eligibility.allowed.length}개
            {dropped.length > 0 && <span className="muted"> · 제거한 열: {dropped.join(", ")}</span>}
          </p>
          <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>과목</th>
                <th>학기</th>
                <th>상태</th>
                <th>매칭</th>
                <th>재수강 허용</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.local_id}>
                  <td>
                    {e.course_name} {e.course_code && <span className="muted">({e.course_code})</span>}
                  </td>
                  <td>{e.term_id ?? "-"}</td>
                  <td>
                    {STATUS_KO[e.completion_status]}
                    {e.recognized === false && " · 불인정"}
                  </td>
                  <td>
                    {e.match_status === "matched" && "현재 개설"}
                    {e.match_status === "historical_only" && <span className="muted">과거 과목(유지)</span>}
                    {e.match_status === "needs_review" && (
                      <Button size="sm" variant="ghost" onClick={() => onUpdate(e.local_id, { match_status: "matched" })}>
                        이름만 일치 — {e.matched_course_id}로 확인
                      </Button>
                    )}
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`${e.course_name} 재수강 허용`}
                      checked={e.allow_retake}
                      disabled={!excludesCourse({ ...e, allow_retake: false })}
                      onChange={(ev) => onUpdate(e.local_id, { allow_retake: ev.target.checked })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <Button size="sm" variant="danger-ghost" onClick={onClearAll} data-testid="clear-data">
            내 데이터 삭제
          </Button>
        </>
      )}
      </details>
    </Card>
  );
}
