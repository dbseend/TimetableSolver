import { useState } from "react";
import type { Catalog, Constraint, DraftConstraint } from "../../lib/types";
import type { NlState } from "../../app/state";
import { Alert, Badge, Button, Icon } from "../../ui";
import { applyPatch, describe, draftToConstraint, isResolved, STRENGTH_LABEL, SUPPORTED_TYPES, TYPE_LABEL } from "./model";
import { FieldEditor, isEditable } from "./FieldEditor";

/** 예시는 현재 지원하는 조건만. 누르면 입력창만 채운다(API 자동 호출 없음). */
const EXAMPLES = ["15~18학점으로, 금요일은 가능하면 비워 주세요.", "주 4일만 등교하고 싶어요.", "오후 6시 이후 수업은 피하고 싶어요."];

interface Props {
  catalog: Catalog;
  nl: NlState;
  parseMode: "live" | "fixture" | "unavailable" | null;
  constraints: Constraint[];
  onParse: (text: string) => void;
  onDrafts: (d: DraftConstraint[]) => void;
  onAck: (i: number) => void;
  onAccept: (c: Omit<Constraint, "id">) => void;
  onDeleteConstraint: (id: string) => void;
  onClear: () => void;
}

export function NlPanel({ catalog, nl, parseMode, constraints, onParse, onDrafts, onAck, onAccept, onDeleteConstraint, onClear }: Props) {
  const [text, setText] = useState("");
  const r = nl.response;
  // 선택지 없는 자유 질문(live 모델)은 항상 보여 준다. 선택지 질문은 아직 미해결 필드에 대해서만.
  const questionsFor = (d: DraftConstraint) =>
    (r?.questions ?? []).filter(
      (q) => q.draft_id === d.draft_id && (q.options.length === 0 || d.unresolved_fields.some((f) => f === q.field || (q.field === "params.time_window" && f.startsWith("params.")))),
    );
  const replace = (d: DraftConstraint, next: DraftConstraint | null) => onDrafts(next ? nl.drafts.map((x) => (x.draft_id === d.draft_id ? next : x)) : nl.drafts.filter((x) => x.draft_id !== d.draft_id));

  const modeBadge =
    parseMode === "fixture" ? (
      <span data-testid="demo-badge">
        <Badge tone="warning" title="LLM이 아닌 규칙 기반 데모 해석기입니다. 등록된 문형만 해석합니다.">
          데모 해석(규칙 기반, LLM 아님)
        </Badge>
      </span>
    ) : parseMode === "live" ? (
      <span className="badge live success">
        <Icon name="sparkle" size={13} /> Gemini 해석
      </span>
    ) : null;

  return (
    <div className="nl-box" data-testid="nl-panel">
      <div className="row between">
        <h2>어떤 시간표를 원하세요?</h2>
        {modeBadge}
      </div>
      {parseMode === "unavailable" ? (
        <Alert tone="info" title="자연어 해석기가 설정되지 않았어요">
          아래 ‘직접 조건 추가’로 조건을 입력하면 시간표를 만들 수 있습니다.
        </Alert>
      ) : (
        <>
          <label className="field" htmlFor="nl-input">
            원하는 조건을 문장으로 적어 주세요 (학번·성적 같은 개인정보는 적지 마세요)
          </label>
          <textarea
            id="nl-input"
            rows={3}
            maxLength={2000}
            value={text}
            placeholder="예: 15~18학점으로, 금요일은 가능하면 비워 주세요."
            onChange={(e) => setText(e.target.value)}
            data-testid="nl-input"
          />
          <div className="examples" aria-label="입력 예시">
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" onClick={() => setText(ex)}>
                {ex}
              </button>
            ))}
          </div>
          <div className="row">
            <Button onClick={() => onParse(text)} disabled={!text.trim() || nl.status === "parsing"} data-testid="nl-parse">
              {nl.status === "parsing" ? "해석하고 있어요…" : "조건으로 바꾸기"}
            </Button>
            {nl.response && (
              <Button variant="ghost" onClick={onClear}>
                해석 결과 모두 버리기
              </Button>
            )}
          </div>
          <p className="xs muted">해석 결과는 확인 전까지 적용되지 않습니다.</p>
        </>
      )}

      {nl.error && (
        <div data-testid="nl-error">
          <Alert tone="danger" title="자연어 해석에 실패했어요">
            {nl.error}
          </Alert>
        </div>
      )}

      {r && (
        <div className="stack" data-testid="nl-result">
          {r.provider_mode === "fixture" && <p className="xs muted">※ 데모 해석 결과입니다.</p>}
          {r.warnings.map((w, i) => (
            <Alert key={i} tone="info">
              {w}
            </Alert>
          ))}
          {nl.drafts.map((d) => {
            const target = d.action === "delete" ? constraints.find((c) => c.id === d.target_constraint_id) : null;
            const resolved = isResolved(d);
            const qs = questionsFor(d);
            // 선택지 질문이 다루지 않는 빈 값은 그 자리에서 입력·선택(조건을 버리고 다시 쓰지 않아도 됨)
            const covered = new Set(qs.filter((q) => q.options.length).flatMap((q) => (q.field === "params.time_window" ? ["params.start_minute", "params.end_minute"] : [q.field])));
            const editable = d.action === "add" ? d.unresolved_fields.filter((f) => isEditable(f) && !covered.has(f)) : [];
            return (
              <div key={d.draft_id} className={`draft ${resolved ? "" : "pending"}`} data-testid={`draft-${d.draft_id}`}>
                <div className="row between">
                  <span className="src">“{d.source_text}”</span>
                  {resolved ? <Badge tone="primary">추가할 수 있어요</Badge> : <Badge tone="warning">확인이 필요해요</Badge>}
                </div>
                <p className="what">
                  {d.action === "delete" ? (
                    <>조건 삭제 제안{target ? `: ${describe(target, catalog)}` : ""}</>
                  ) : (
                    <>
                      <span className="muted xs">{TYPE_LABEL[d.type as keyof typeof TYPE_LABEL] ?? d.type} · </span>
                      {SUPPORTED_TYPES.includes(d.type as never) && describe(d, catalog)}
                    </>
                  )}
                </p>
                {d.action === "add" && (
                  <div className="row" role="group" aria-label="지키는 정도" style={{ marginTop: 8 }}>
                    {(["hard", "soft"] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        className="toggle"
                        aria-pressed={d.strength === s}
                        onClick={() => replace(d, applyPatch(d, "strength", { strength: s, weight: s === "soft" ? (d.weight ?? 5) : null }))}
                      >
                        {STRENGTH_LABEL[s]}
                      </button>
                    ))}
                  </div>
                )}
                {qs.map((q) => (
                  <div key={q.id} className="question" data-testid={`question-${q.id}`}>
                    <p>{q.message}</p>
                    {q.options.length === 0 && <p className="xs muted">선택지가 없는 질문입니다. 아래에서 빈 값을 직접 정하거나 이 초안을 버리세요.</p>}
                    <div className="row">
                      {q.options.map((o) => (
                        <button key={o.id} type="button" className="option" onClick={() => replace(d, applyPatch(d, q.field, o.patch))}>
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {editable.map((f) => (
                  <FieldEditor key={f} catalog={catalog} draft={d} field={f as never} onApply={(value) => replace(d, applyPatch(d, f, { [f]: value }))} />
                ))}
                {!resolved && !qs.length && !editable.length && (
                  <p className="xs warn" style={{ marginTop: 8 }}>
                    확인할 값이 남아 있어 추가할 수 없어요. 버리고 ‘직접 조건 추가’로 입력해 주세요.
                  </p>
                )}
                <div className="row" style={{ marginTop: 12 }}>
                  <Button
                    size="sm"
                    disabled={!resolved}
                    data-testid={`accept-${d.draft_id}`}
                    onClick={() => {
                      if (d.action === "delete") {
                        if (d.target_constraint_id) onDeleteConstraint(d.target_constraint_id);
                      } else {
                        const c = draftToConstraint(d, "tmp");
                        if (!c) return;
                        const { id: _ignored, ...rest } = c;
                        void _ignored;
                        onAccept(rest);
                      }
                      replace(d, null);
                    }}
                  >
                    {d.action === "delete" ? "삭제 적용" : "조건에 추가"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => replace(d, null)}>
                    버리기
                  </Button>
                </div>
              </div>
            );
          })}
          {r.unsupported_requests.length > 0 && (
            <div data-testid="nl-unsupported">
              <Alert tone="warning" title="반영하지 못한 요구가 있어요 (조용히 버리지 않습니다)">
                <ul className="sat-list">
                  {r.unsupported_requests.map((u, i) => (
                    <li key={i} style={{ display: "block" }}>
                      “{u.source_text}” — {u.message} <code>{u.reason_code}</code>{" "}
                      {nl.acknowledgedUnsupported.includes(i) ? (
                        <span className="strong">· 제외 확인됨</span>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => onAck(i)} data-testid={`ack-${i}`}>
                          이 요구 없이 진행
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </Alert>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
