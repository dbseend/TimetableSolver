import { useState } from "react";
import type { Catalog, Constraint, DiagnosisResponse, RelaxationProposal } from "../../lib/types";
import { fmtCredits } from "../../lib/time";
import { Alert, Badge, Button, Icon } from "../../ui";
import { describe, STRENGTH_LABEL, TYPE_LABEL } from "../constraints/model";
import { TimetableGrid } from "../timetable/TimetableGrid";
import { violationText } from "../timetable/ResultsPanel";

function cText(raw: Record<string, unknown>, catalog: Catalog): string {
  const c = raw as unknown as Constraint;
  return `${describe(c, catalog)} · ${c.strength === "hard" ? STRENGTH_LABEL.hard : `${STRENGTH_LABEL.soft}(중요도 ${c.weight})`}`;
}

export function DiagnosisPanel({
  catalog,
  constraints,
  response,
  onApply,
}: {
  catalog: Catalog;
  constraints: Constraint[];
  response: DiagnosisResponse;
  onApply: (p: RelaxationProposal) => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const byId = new Map(constraints.map((c) => [c.id, c]));
  const statusText = {
    diagnosed: "진단을 마쳤어요",
    partial: "충돌 조건은 찾았지만 수정안 탐색을 끝내지 못했어요",
    unknown: "시간 안에 진단하지 못했어요 (불가능 여부 미판정)",
    not_infeasible: "다시 확인해 보니 가능한 시간표가 있어요. 다시 만들어 보세요",
  }[response.status];

  return (
    <div className="stack" data-testid="diagnosis">
      <h3>{statusText}</h3>
      {response.background_infeasible && (
        <Alert tone="danger" title="사용자 조건과 무관하게 데이터만으로도 시간표를 만들 수 없어요">
          허용 분반이 부족할 수 있어요. 이수내역 처리 결과와 강좌 데이터를 확인해 주세요.
        </Alert>
      )}
      {response.core_constraint_ids.length > 0 && (
        <div>
          <p className="small">함께 만족할 수 없는 조건 묶음이에요. 이 묶음이 꼭 최소 원인은 아닐 수 있어요.</p>
          <ul className="sat-list" data-testid="core">
            {response.core_constraint_ids.map((id) => {
              const c = byId.get(id);
              return (
                <li key={id}>
                  <span className="warn">
                    <Icon name="alert" />
                  </span>
                  <span>{c ? `${describe(c, catalog)} (${TYPE_LABEL[c.type]})` : id}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <p className="xs muted">{response.scope_note}</p>
      {response.proposals.length === 0 && response.status === "diagnosed" && (
        <p className="small" data-testid="no-proposal">
          조건 하나만 바꾸는 범위에서는 해결하는 수정안을 찾지 못했어요. 여러 조건을 직접 바꿔 보세요. (수정안이 존재하지 않는다는 뜻은 아닙니다.)
        </p>
      )}
      {response.proposals.map((p, i) => (
        <div key={p.proposal_id} className="proposal stack" data-testid={`proposal-${p.proposal_id}`}>
          <div className="row between">
            <b>수정안 {i + 1}</b>
            <Badge tone="success">✓ 검증된 새 시간표 있음</Badge>
          </div>
          {p.changes.map((ch) => (
            <div key={ch.constraint_id} className="change">
              <span className="before">{cText(ch.before, catalog)}</span>
              <span aria-hidden>→</span>
              <span className="after">{cText(ch.after, catalog)}</span>
            </div>
          ))}
          <p className="small muted">
            새 시간표 {fmtCredits(p.verified_candidate.total_credit_units)}학점
            {p.original_soft_score !== null && ` · 기존 가능하면 조건 점수 ${Math.round(p.original_soft_score)}점`}
            {p.changed_constraint_violations.map((e) => (
              <span key={e.constraint_id}> · 바뀐 조건은 {e.satisfied ? "충족" : `${violationText(e.violation, e.unit)} 어긋남`}</span>
            ))}
          </p>
          {preview === p.proposal_id ? (
            <>
              <TimetableGrid catalog={catalog} sectionIds={p.verified_candidate.selected_section_ids} testId="proposal-grid" />
              <Alert tone="warning">적용하면 위 조건 하나가 바뀌고, 바뀐 조건 전체로 시간표를 다시 만듭니다.</Alert>
              <div className="row">
                <Button onClick={() => onApply(p)} data-testid="apply-proposal">
                  변경 내용 확인하고 적용
                </Button>
                <Button variant="secondary" onClick={() => setPreview(null)}>
                  취소
                </Button>
              </div>
            </>
          ) : (
            <div>
              <Button variant="secondary" size="sm" onClick={() => setPreview(p.proposal_id)} data-testid={`preview-${p.proposal_id}`}>
                새 시간표 미리보기
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
