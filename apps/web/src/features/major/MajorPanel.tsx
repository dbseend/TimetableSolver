import { useMemo, useState } from "react";
import type { LoadedCatalog } from "../../app/state";
import { fmtCredits } from "../../lib/time";
import { Alert, Badge, Button, Card } from "../../ui";
import { majorCandidates, majorSections, MY_MAJOR_GROUP } from "./major";
import { allCategoryIds, sectionVariation } from "../../lib/catalog";

/**
 * 내 전공 과목 확인. 개설 소속·전공 유형은 후보를 좁히는 보조 정보이고,
 * 사용자가 과목 목록을 확인해야만 '내 전공' 분류가 생긴다.
 */
export function MajorPanel({
  loaded,
  busy,
  error,
  onApply,
  onClear,
}: {
  loaded: LoadedCatalog;
  busy: boolean;
  error: string | null;
  onApply: (courseIds: string[], orgs: string[], types: string[]) => void;
  onClear: () => void;
}) {
  const c = loaded.catalog;
  const orgsAll = useMemo(() => [...new Set(Object.values(loaded.courseOrgs))].sort(), [loaded.courseOrgs]);
  const [open, setOpen] = useState(false);
  const [orgs, setOrgs] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>(loaded.majorTypeCategories);
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const candidates = useMemo(() => (orgs.length ? majorCandidates(c, loaded.courseOrgs, orgs, types) : []), [c, loaded.courseOrgs, orgs, types]);
  const selected = candidates.filter((id) => !unchecked.has(id));
  const course = (id: string) => c.courses.find((x) => x.id === id);

  if (!loaded.majorTypeCategories.length && !loaded.major) return null;

  return (
    <Card tight aria-labelledby="major-h" data-testid="major-panel">
      <div className="row between">
        <h3 id="major-h">내 전공 학점 기준</h3>
        {loaded.major ? <Badge tone="success">✓ 과목 {loaded.major.courseIds.length}개 확인됨</Badge> : <Badge tone="warning">미확인</Badge>}
      </div>
      {loaded.major ? (
        <div className="stack" style={{ marginTop: 8 }}>
          <p className="small">
            ‘{MY_MAJOR_GROUP}’ 분류 = 내가 확인한 과목 {loaded.major.courseIds.length}개. 분류별 최소 학점 조건에서 ‘{MY_MAJOR_GROUP}’ 그룹을 고를 수 있어요.
          </p>
          <p className="xs muted">
            후보 범위: {loaded.major.orgs.join(", ") || "-"} · {loaded.major.types.join("·")} · 확인 {loaded.major.confirmedAt.slice(0, 16).replace("T", " ")}
          </p>
          <div>
            <Button size="sm" variant="secondary" onClick={onClear} disabled={busy} data-testid="major-clear">
              기준 지우기
            </Button>
          </div>
        </div>
      ) : (
        <p className="small muted" style={{ marginTop: 8 }} data-testid="major-status">
          전필·전선 같은 전공 유형은 학부와 관계없이 모든 과목에 붙어 있어요. 내 전공 과목을 확인하기 전에는 ‘내 전공 최소 학점’ 조건을 쓸 수 없고, 나머지 시간표 기능은 그대로 쓸 수 있어요.
        </p>
      )}

      {!loaded.major && !open && (
        <div style={{ marginTop: 10 }}>
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)} data-testid="major-open">
            내 전공 과목 정하기
          </Button>
        </div>
      )}

      {!loaded.major && open && (
        <div className="stack" style={{ marginTop: 12 }}>
          {orgsAll.length === 0 ? (
            <Alert tone="info">파일에 개설 소속 열이 없어 후보를 좁힐 수 없어요. 가져오기 매핑에서 ‘개설 소속’ 열을 연결해 주세요.</Alert>
          ) : (
            <>
              <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="small strong">1. 후보를 찾을 개설 소속 (개설 소속 ≠ 전공 인정 기준일 수 있어요)</legend>
                <div className="row">
                  {orgsAll.map((o) => (
                    <label key={o} className="check">
                      <input
                        type="checkbox"
                        checked={orgs.includes(o)}
                        onChange={(e) => {
                          setOrgs(e.target.checked ? [...orgs, o] : orgs.filter((x) => x !== o));
                          setConfirm(false);
                        }}
                      />
                      {o}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="small strong">2. 전공 유형 이수구분</legend>
                <div className="row">
                  {[...new Set([...loaded.majorTypeCategories, ...allCategoryIds(c)])].sort().map((t) => (
                    <label key={t} className="check">
                      <input
                        type="checkbox"
                        checked={types.includes(t)}
                        onChange={(e) => {
                          setTypes(e.target.checked ? [...types, t] : types.filter((x) => x !== t));
                          setConfirm(false);
                        }}
                      />
                      {t}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div>
                <p className="small strong">3. 과목 확인 ({selected.length}/{candidates.length}개 선택)</p>
                {candidates.length === 0 ? (
                  <p className="small muted">개설 소속을 고르면 후보가 나와요.</p>
                ) : (
                  <ul className="issues" data-testid="major-candidates" style={{ maxHeight: 220 }}>
                    {candidates.map((id) => (
                      <li key={id} style={{ gridTemplateColumns: "auto 1fr auto" }}>
                        <input
                          type="checkbox"
                          aria-label={`${course(id)?.name} 내 전공 과목으로 포함`}
                          checked={!unchecked.has(id)}
                          onChange={(e) => {
                            const n = new Set(unchecked);
                            if (e.target.checked) n.delete(id);
                            else n.add(id);
                            setUnchecked(n);
                            setConfirm(false);
                          }}
                        />
                        <span>
                          {course(id)?.name}{" "}
                          <span className="muted">
                            ({id} · {sectionVariation(c, id).categories.map((x) => x.join("·")).join(" / ")})
                          </span>
                          {majorSections(c, id, types).length < c.sections.filter((x) => x.course_id === id).length && (
                            <span className="warn xs"> · 분반 {majorSections(c, id, types).length}개만 전공 유형</span>
                          )}
                        </span>
                        <span className="num">{sectionVariation(c, id).units.map((u) => fmtCredits(u)).join("/")}학점</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <label className="check">
                <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} data-testid="major-confirm" disabled={!selected.length} />
                선택한 과목이 학교 규칙상 내 전공 학점으로 인정되는지 확인했습니다
              </label>
              <p className="xs muted">복수전공·타 학과 과목 인정은 자동으로 판정하지 않아요. 인정되는 과목만 직접 남겨 주세요.</p>
              <div className="row">
                <Button size="sm" onClick={() => onApply(selected, orgs, types)} disabled={!confirm || !selected.length || busy} data-testid="major-apply">
                  {busy ? "적용 중…" : "이 과목들로 내 전공 기준 적용"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                  닫기
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      {error && (
        <p className="error small" role="alert" style={{ marginTop: 8 }}>
          {error}
        </p>
      )}
    </Card>
  );
}
