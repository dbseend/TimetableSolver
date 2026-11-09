/**
 * 생성 버튼 바로 위의 '확인할 조건' 영역 + 최종 조건 요약 + 주요 버튼 하나.
 * - 확인할 조건이 있으면 버튼은 '조건 N개 확인하기' → 첫 항목으로 이동·포커스(/solve 호출 안 함).
 * - 모두 해결되면 요약과 '이 조건으로 시간표 만들기' → 클릭 시점 스냅샷으로 확정·생성(App에서 처리).
 * - 각 항목: 원문 · 무엇이 불명확한지 · 바로 고칠 입력/선택 · 이대로 반영 · 이 조건 제외.
 */
import { useEffect, useRef, useState } from "react";
import type { Catalog, Constraint, DraftConstraint } from "../../lib/types";
import { Badge, Button, Icon } from "../../ui";
import { describe, STRENGTH_LABEL, TYPE_LABEL } from "../constraints/model";
import { DraftForm } from "./DraftForm";
import type { ConstraintMeta, ReviewItem } from "./review";

export interface ReviewHandlers {
  applyDraft: (draftId: string, d: DraftConstraint) => void;
  discardDraft: (draftId: string) => void;
  resolveConflict: (draftId: string, mode: "keep" | "replace", params?: Record<string, unknown>) => void;
  excludeUnsupported: (index: number) => void;
  addConstraint: (c: Omit<Constraint, "id">) => void;
  replaceConstraint: (c: Constraint) => void;
  removeConstraints: (ids: string[]) => void;
  openMajor: () => void;
}

function explain(d: DraftConstraint): string {
  const f = d.unresolved_fields;
  if (d.type === "credit_range" && (f.includes("params.min_units") || f.includes("params.max_units"))) return "총 학점 범위를 확인해 주세요.";
  if (d.type === "time_avoid" && f.some((x) => x.startsWith("params."))) return "피하고 싶은 시간과 요일을 정해 주세요.";
  if (d.type === "day_off" && f.includes("params.days")) return "비우고 싶은 요일을 골라 주세요.";
  if (f.includes("params.allowed_section_ids")) return "어느 교수의 분반으로 제한할지 골라 주세요.";
  if (f.includes("params.course_id")) return "어느 과목인지 골라 주세요.";
  if (f.includes("params.category_ids")) return "어떤 분류(이수구분)를 셀지 골라 주세요.";
  if (f.includes("interpretation")) return "문장의 뜻을 골라 주세요.";
  if (f.includes("strength")) return "꼭 지켜야 하는지, 가능하면 지키면 되는지 골라 주세요.";
  return "비어 있는 값을 채워 주세요.";
}

export function ReviewPanel({
  catalog,
  items,
  constraints,
  meta,
  handlers,
  onGenerate,
  generating,
  blockedReason,
}: {
  catalog: Catalog;
  items: ReviewItem[];
  constraints: Constraint[];
  meta: Record<string, ConstraintMeta>;
  handlers: ReviewHandlers;
  onGenerate: () => void;
  generating: boolean;
  blockedReason: string | null;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const prevCount = useRef(items.length);
  const [done, setDone] = useState<string | null>(null);
  const [conflictMode, setConflictMode] = useState<Record<string, "keep" | "replace" | "edit">>({});
  const [keepCredit, setKeepCredit] = useState<string>("");

  const focusItem = (i: number) => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-review-index="${i}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    const target = el.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea, button");
    (target ?? el).focus({ preventScroll: true });
  };

  // 항목을 하나 해결하면 다음 항목(같은 위치)으로 포커스를 옮겨 흐름이 끊기지 않게 한다. 마지막이면 생성 버튼으로.
  useEffect(() => {
    if (items.length < prevCount.current) {
      if (items.length) focusItem(0);
      else document.querySelector<HTMLElement>("[data-testid=solve]")?.focus();
    }
    prevCount.current = items.length;
  }, [items.length]);

  const finish = (msg: string, fn: () => void) => {
    fn();
    setDone(msg);
  };

  const card = (it: ReviewItem, i: number, body: React.ReactNode, title: React.ReactNode, original?: string) => (
    <section key={it.key} className="draft pending" data-review-index={i} data-testid={`review-item-${i}`} data-kind={it.kind} tabIndex={-1} aria-labelledby={`ri-${it.key}`}>
      <div className="row between">
        <Badge tone="warning">
          <Icon name="alert" size={12} /> 확인 필요
        </Badge>
        <span className="xs muted">
          {i + 1} / {items.length}
        </span>
      </div>
      {original && <p className="src" style={{ marginTop: 6 }}>“{original}”</p>}
      <p className="what" id={`ri-${it.key}`}>
        {title}
      </p>
      <div style={{ marginTop: 10 }}>{body}</div>
    </section>
  );

  const exclude = (label: string, onClick: () => void, testId: string) => (
    <Button size="sm" variant="ghost" onClick={onClick} data-testid={testId}>
      {label}
    </Button>
  );

  return (
    <div className="stack" data-testid="review-panel">
      {items.length > 0 ? (
        <div>
          <h3 data-testid="review-count">이것만 확인하면 시간표를 만들 수 있어요 · 확인할 조건 {items.length}개</h3>
          <p className="xs muted">확인을 마친 조건은 위 ‘내 조건’ 목록으로 옮겨져요.</p>
        </div>
      ) : (
        <h3 data-testid="review-count">조건이 모두 준비됐어요</h3>
      )}
      <p className="ok small" role="status" aria-live="polite" data-testid="review-done">
        {done ? `✓ ${done}` : ""}
      </p>

      <div className="stack" ref={listRef}>
        {items.map((it, i) => {
          const tp = `ri${i}`;
          switch (it.kind) {
            case "draft": {
              const d = it.draft;
              return card(
                it,
                i,
                <DraftForm
                  catalog={catalog}
                  draft={d}
                  submitLabel="이대로 반영"
                  testIdPrefix={tp}
                  onSubmit={(r) => finish(`“${d.source_text}” 반영 완료`, () => handlers.applyDraft(d.draft_id, r))}
                  onDiscard={() => finish(`“${d.source_text}” 제외`, () => handlers.discardDraft(d.draft_id))}
                  onCancel={() => finish(`“${d.source_text}” 제외`, () => handlers.discardDraft(d.draft_id))}
                  cancelLabel="이 조건 제외"
                />,
                <>
                  <span className="muted xs">{TYPE_LABEL[d.type as keyof typeof TYPE_LABEL] ?? d.type} · </span>
                  {explain(d)}
                </>,
                d.source_text,
              );
            }
            case "conflict": {
              const d = it.draft;
              const mode = conflictMode[d.draft_id] ?? "";
              return card(
                it,
                i,
                <div className="stack">
                  <div className="change" data-testid={`${tp}-compare`}>
                    <span>
                      <span className="xs muted">기존 조건{meta[it.existing.id]?.suggested ? " (기본 제안값)" : ""}</span>
                      <br />
                      <b>{describe(it.existing, catalog)}</b>
                    </span>
                    <span aria-hidden>↔</span>
                    <span>
                      <span className="xs muted">새 요청</span>
                      <br />
                      <b>{describe(d, catalog)}</b>
                    </span>
                  </div>
                  <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
                    <legend className="small strong">어떻게 할까요?</legend>
                    {(
                      [
                        ["keep", "기존 조건 유지"],
                        ["replace", "새 조건으로 변경"],
                        ["edit", "직접 수정"],
                      ] as const
                    ).map(([k, label]) => (
                      <label key={k} className="check">
                        <input type="radio" name={`${tp}-mode`} checked={mode === k} onChange={() => setConflictMode({ ...conflictMode, [d.draft_id]: k })} data-testid={`${tp}-${k}`} />
                        {label}
                      </label>
                    ))}
                  </fieldset>
                  {mode === "edit" ? (
                    <DraftForm
                      catalog={catalog}
                      draft={{ ...d, unresolved_fields: [] }}
                      fields={["params.min_units", "params.max_units"]}
                      editAll={false}
                      submitLabel="이대로 반영"
                      testIdPrefix={`${tp}-edit`}
                      onSubmit={(r) => finish("학점 범위를 직접 고쳐 반영했어요", () => handlers.resolveConflict(d.draft_id, "replace", r.params))}
                    />
                  ) : (
                    <div className="row">
                      <Button
                        size="sm"
                        disabled={!mode}
                        onClick={() => finish(mode === "keep" ? "기존 조건을 유지했어요" : "새 조건으로 바꿨어요", () => handlers.resolveConflict(d.draft_id, mode as "keep" | "replace"))}
                        data-testid={`${tp}-apply`}
                      >
                        이대로 반영
                      </Button>
                      {!mode && <span className="xs muted">위에서 하나를 골라 주세요.</span>}
                    </div>
                  )}
                </div>,
                "이미 있는 학점 범위와 새 요청이 달라요. 기존 조건은 고르기 전까지 그대로예요.",
                d.source_text,
              );
            }
            case "delete":
              return card(
                it,
                i,
                <div className="row">
                  <Button size="sm" onClick={() => finish("조건을 삭제했어요", () => handlers.applyDraft(it.draft.draft_id, it.draft))} disabled={!it.target} data-testid={`${tp}-apply`}>
                    삭제 반영
                  </Button>
                  {exclude("이 요청 제외(조건 유지)", () => finish("삭제 요청을 제외했어요", () => handlers.discardDraft(it.draft.draft_id)), `${tp}-exclude`)}
                </div>,
                it.target ? `기존 조건 “${describe(it.target, catalog)}”을(를) 지울까요?` : "지우려는 조건을 찾지 못했어요.",
                it.draft.source_text,
              );
            case "unsupported":
              return card(
                it,
                i,
                <div className="stack">
                  <p className="small">
                    {it.message} <code>{it.reason_code}</code>
                  </p>
                  <p className="xs muted">지원하지 않는 요구는 반영하지 않아요. 제외하면 나머지 조건으로 시간표를 만들 수 있어요.</p>
                  <div>{exclude("이 조건 제외하고 계속", () => finish(`“${it.source_text}” 제외(지원하지 않음)`, () => handlers.excludeUnsupported(it.index)), `${tp}-exclude`)}</div>
                </div>,
                "지금은 지원하지 않는 조건이에요.",
                it.source_text,
              );
            case "credit":
              if (it.problem === "multiple")
                return card(
                  it,
                  i,
                  <div className="stack">
                    {it.constraints.map((c) => (
                      <label key={c.id} className="check">
                        <input type="radio" name={`${tp}-keep`} checked={keepCredit === c.id} onChange={() => setKeepCredit(c.id)} />
                        {describe(c, catalog)}
                      </label>
                    ))}
                    <div>
                      <Button
                        size="sm"
                        disabled={!keepCredit}
                        onClick={() => finish("학점 범위를 하나로 정리했어요", () => handlers.removeConstraints(it.constraints.filter((c) => c.id !== keepCredit).map((c) => c.id)))}
                        data-testid={`${tp}-apply`}
                      >
                        이것만 남기기
                      </Button>
                    </div>
                  </div>,
                  "꼭 지키는 총 학점 범위는 하나만 둘 수 있어요. 남길 것을 골라 주세요.",
                );
              return card(
                it,
                i,
                <DraftForm
                  catalog={catalog}
                  draft={{
                    draft_id: "credit",
                    type: "credit_range",
                    strength: "hard",
                    weight: null,
                    params: { min_units: null, max_units: it.constraints[0]?.params ? (it.constraints[0].params as { max_units: number }).max_units : null },
                    source_text: "",
                    unresolved_fields: ["params.min_units", "params.max_units"],
                    action: "add",
                    target_constraint_id: null,
                  }}
                  fields={["params.min_units", "params.max_units"]}
                  submitLabel="이대로 반영"
                  testIdPrefix={tp}
                  onSubmit={(r) =>
                    finish("총 학점 범위를 정했어요", () =>
                      it.problem === "nonpositive" && it.constraints[0]
                        ? handlers.replaceConstraint({ ...it.constraints[0], params: r.params } as Constraint)
                        : handlers.addConstraint({ type: "credit_range", strength: "hard", weight: null, params: r.params } as Omit<Constraint, "id">),
                    )
                  }
                />,
                it.problem === "missing" ? "총 학점 범위(꼭 지키기)가 필요해요. 최소 학점은 0보다 커야 해요." : "총 학점 범위의 최소 학점은 0보다 커야 해요.",
              );
            case "major":
              return card(
                it,
                i,
                <div className="row">
                  <Button size="sm" onClick={handlers.openMajor} data-testid={`${tp}-open-major`}>
                    내 전공 과목 정하기
                  </Button>
                  {exclude("이 조건 제외", () => finish("전공 학점 조건을 제외했어요", () => handlers.removeConstraints(it.constraintIds)), `${tp}-exclude`)}
                </div>,
                it.message,
              );
          }
        })}
      </div>

      {items.length === 0 && (
        <div data-testid="final-summary">
          <h4>이 조건으로 만들어요</h4>
          <ul className="sat-list">
            {constraints.map((c) => (
              <li key={c.id}>
                <span className="ok">
                  <Icon name="check" />
                </span>
                <span>
                  {describe(c, catalog)} <span className="xs muted">· {c.strength === "hard" ? STRENGTH_LABEL.hard : `${STRENGTH_LABEL.soft} (중요도 ${c.weight})`}</span>
                  {meta[c.id]?.suggested && <span className="badge warning" style={{ marginLeft: 4 }}>기본 제안값</span>}
                </span>
              </li>
            ))}
          </ul>
          <p className="xs muted" style={{ marginTop: 8 }}>
            버튼을 누르면 지금 보이는 조건으로 확정하고 시간표를 만들어요.
          </p>
        </div>
      )}
      {blockedReason && items.length === 0 && (
        <p className="reason" data-testid="confirm-reason">
          <Icon name="info" /> {blockedReason}
        </p>
      )}
      <Button
        block
        onClick={() => (items.length ? focusItem(0) : onGenerate())}
        disabled={generating || (!items.length && !!blockedReason)}
        data-testid="solve"
        aria-describedby={items.length ? "review-count-desc" : undefined}
      >
        {generating ? "시간표를 만드는 중…" : items.length ? `조건 ${items.length}개 확인하기` : "이 조건으로 시간표 만들기"}
      </Button>
      {items.length > 0 && (
        <p id="review-count-desc" className="xs muted">
          누르면 첫 번째 확인할 조건으로 이동해요. 이 단계에서는 시간표 계산을 요청하지 않아요.
        </p>
      )}
    </div>
  );
}
