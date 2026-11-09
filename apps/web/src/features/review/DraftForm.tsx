/**
 * 조건 하나의 값 입력 폼(확인할 조건·반영된 조건 수정에 공용).
 * - 여러 빈 값을 한 번에 채우고 '이대로 반영'.
 * - 사용자가 말하지 않은 값은 '제안값'으로 표시만 하고, 반영 버튼을 눌러야 적용된다.
 * - 오류는 해당 입력 바로 아래. 반영 전에는 조건 목록·생성 요청에 들어가지 않는다.
 */
import { useId, useState } from "react";
import type { Catalog, Day, DraftConstraint, Question } from "../../lib/types";
import { DAY_KO, DAYS } from "../../lib/types";
import { fmtCredits, fmtMin } from "../../lib/time";
import { allCategoryIds } from "../../lib/catalog";
import { Button } from "../../ui";
import { applyPatch, isResolved } from "../constraints/model";
import { isEditable, validateFieldValue } from "../constraints/FieldEditor";

type Field = Parameters<typeof validateFieldValue>[1];
type Value = string | string[];

const LABEL: Record<string, string> = {
  "params.min_units": "최소 학점",
  "params.max_units": "최대 학점",
  "params.days": "요일",
  "params.start_minute": "시작 시각",
  "params.end_minute": "종료 시각",
  "params.max_days": "주 최대 등교일",
  "params.category_ids": "분류",
  "params.course_id": "과목",
  "params.instructor_ids": "교수",
};

/** 현재 값 → 입력 문자열 */
function toInput(field: Field, v: unknown): Value | undefined {
  if (v === null || v === undefined) return undefined;
  if (field === "params.min_units" || field === "params.max_units") return fmtCredits(v as number);
  if (field === "params.start_minute" || field === "params.end_minute") return fmtMin(v as number);
  if (field === "params.max_days") return String(v);
  if (Array.isArray(v)) return v as string[];
  return String(v);
}

/** 사용자가 말하지 않은 값에 대한 제안(확정 아님) */
export function suggestion(d: DraftConstraint, field: Field): Value | undefined {
  const p = d.params as Record<string, unknown>;
  if (d.type === "time_avoid" && field === "params.days") return ["Mon", "Tue", "Wed", "Thu", "Fri"];
  if (d.type === "time_avoid" && field === "params.end_minute" && typeof p.start_minute === "number" && p.start_minute >= 720) return "24:00";
  if (d.type === "credit_range" && field === "params.min_units" && p.max_units == null) return "15";
  if (d.type === "credit_range" && field === "params.max_units" && p.min_units == null) return "18";
  return undefined;
}

export interface DraftFormProps {
  catalog: Catalog;
  draft: DraftConstraint & { questions?: Question[] };
  /** 보여 줄 입력 필드. 생략하면 미해결 필드 */
  fields?: string[];
  /** 이미 값이 있어도 보여 주고 고치게 할지(수정 모드) */
  editAll?: boolean;
  submitLabel: string;
  onSubmit: (d: DraftConstraint) => void;
  onCancel?: () => void;
  cancelLabel?: string;
  /** 질문 선택지에서 '버리기'를 고르고 반영했을 때 */
  onDiscard?: () => void;
  testIdPrefix: string;
}

export function DraftForm({ catalog, draft, fields, editAll, submitLabel, onSubmit, onCancel, cancelLabel, onDiscard, testIdPrefix }: DraftFormProps) {
  const uid = useId();
  const p = draft.params as Record<string, unknown>;
  const optionQs = (draft.questions ?? []).filter((q) => q.options.length && (draft.unresolved_fields.includes(q.field) || (q.field === "params.time_window" && draft.unresolved_fields.some((f) => f.startsWith("params.")))));
  const covered = new Set(optionQs.flatMap((q) => (q.field === "params.time_window" ? ["params.start_minute", "params.end_minute"] : [q.field])));
  const freeQs = (draft.questions ?? []).filter((q) => !q.options.length);
  const shown = (fields ?? draft.unresolved_fields).filter((f) => isEditable(f) && !covered.has(f)) as Field[];
  const needStrength = draft.action === "add" && (draft.unresolved_fields.includes("strength") || editAll);

  const [values, setValues] = useState<Record<string, Value>>(() => {
    const init: Record<string, Value> = {};
    for (const f of shown) {
      const cur = toInput(f, p[f.slice(7)]);
      const sug = cur === undefined ? suggestion(draft, f) : undefined;
      if (cur !== undefined) init[f] = cur;
      else if (sug !== undefined) init[f] = sug;
    }
    return init;
  });
  const [suggested, setSuggested] = useState<Set<string>>(() => new Set(shown.filter((f) => toInput(f, p[f.slice(7)]) === undefined && suggestion(draft, f) !== undefined)));
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [strength, setStrength] = useState<"hard" | "soft" | null>(draft.strength);
  const [weight, setWeight] = useState<number>(draft.weight ?? 5);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = (f: string, v: Value) => {
    setValues({ ...values, [f]: v });
    if (suggested.has(f)) setSuggested(new Set([...suggested].filter((x) => x !== f)));
  };
  const toggle = (f: string, item: string, on: boolean) => {
    const cur = (values[f] as string[] | undefined) ?? [];
    set(f, on ? [...cur, item] : cur.filter((x) => x !== item));
  };

  function submit() {
    let d: DraftConstraint | null = { ...draft, params: { ...draft.params }, unresolved_fields: [...draft.unresolved_fields] };
    const errs: Record<string, string> = {};
    if (needStrength) {
      if (!strength) errs.strength = "꼭 지키기 또는 가능하면 중 하나를 골라 주세요.";
      else d = applyPatch(d!, "strength", { strength, weight: strength === "soft" ? weight : null });
    }
    for (const q of optionQs) {
      const opt = q.options.find((o) => o.id === answers[q.id]);
      if (!opt) errs[q.id] = "하나를 골라 주세요.";
      else if (d) d = applyPatch(d, q.field, opt.patch);
    }
    for (const f of shown) {
      if (!d) break;
      const raw = values[f] ?? (f === "params.days" || f === "params.category_ids" || f === "params.instructor_ids" ? [] : "");
      const r = validateFieldValue(d, f, raw);
      if ("error" in r) errs[f] = r.error;
      else d = applyPatch(d, f, { [f]: r.value });
    }
    setErrors(errs);
    if (Object.keys(errs).length) {
      const first = Object.keys(errs)[0];
      (document.getElementById(`${uid}-${first}`) as HTMLElement | null)?.focus();
      return;
    }
    if (d === null) return onDiscard?.(); // 선택지에서 '이 조건 버리기'를 고른 경우
    if (!isResolved(d)) {
      setErrors({ _: "아직 비어 있는 값이 있어요." });
      return;
    }
    onSubmit(d);
  }

  const err = (k: string) =>
    errors[k] ? (
      <p className="error xs" id={`${uid}-${k}-err`} role="alert" style={{ marginTop: 4 }}>
        {errors[k]}
      </p>
    ) : null;

  return (
    <div className="stack" onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT" && (e.preventDefault(), submit())}>
      {freeQs.map((q) => (
        <p key={q.id} className="small muted">
          모델 질문: {q.message}
        </p>
      ))}
      {needStrength && (
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small strong">지키는 정도</legend>
          <div className="row">
            {(["hard", "soft"] as const).map((s, i) => (
              <label key={s} className="check">
                <input id={i === 0 ? `${uid}-strength` : undefined} type="radio" name={`${uid}-strength`} checked={strength === s} onChange={() => setStrength(s)} />
                {s === "hard" ? "꼭 지키기" : "가능하면"}
              </label>
            ))}
            {strength === "soft" && (
              <label className="check">
                중요도
                <select value={weight} onChange={(e) => setWeight(Number(e.target.value))} style={{ minHeight: 32, padding: "4px 8px" }}>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((w) => (
                    <option key={w}>{w}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {err("strength")}
        </fieldset>
      )}
      {optionQs.map((q) => (
        <fieldset key={q.id} className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small strong">{q.message}</legend>
          <div className="stack" style={{ marginTop: 6 }}>
            {q.options.map((o, i) => (
              <label key={o.id} className="check">
                <input id={i === 0 ? `${uid}-${q.id}` : undefined} type="radio" name={`${uid}-${q.id}`} checked={answers[q.id] === o.id} onChange={() => setAnswers({ ...answers, [q.id]: o.id })} />
                {o.label}
              </label>
            ))}
          </div>
          {err(q.id)}
        </fieldset>
      ))}
      {shown.map((f) => {
        const id = `${uid}-${f}`;
        const isList = f === "params.days" || f === "params.category_ids" || f === "params.instructor_ids";
        const v = values[f];
        return (
          <div key={f} className="field" data-testid={`${testIdPrefix}-${f.slice(7)}`}>
            <label htmlFor={isList ? undefined : id} className="small strong">
              {LABEL[f]} {suggested.has(f) && <span className="badge warning">제안값 · 확인 후 반영</span>}
            </label>
            {(f === "params.min_units" || f === "params.max_units") && (
              <div className="row">
                <input id={id} className="num" inputMode="decimal" value={(v as string) ?? ""} placeholder={f === "params.min_units" ? "예: 15" : "예: 18"} onChange={(e) => set(f, e.target.value)} aria-describedby={errors[f] ? `${id}-err` : undefined} aria-invalid={!!errors[f]} />
                <span className="small">학점</span>
              </div>
            )}
            {(f === "params.start_minute" || f === "params.end_minute") && (
              <input id={id} type="text" inputMode="numeric" placeholder="HH:MM" className="num" style={{ width: 96 }} value={(v as string) ?? ""} onChange={(e) => set(f, e.target.value)} aria-describedby={errors[f] ? `${id}-err` : undefined} aria-invalid={!!errors[f]} />
            )}
            {f === "params.max_days" && <input id={id} className="num" inputMode="numeric" value={(v as string) ?? ""} onChange={(e) => set(f, e.target.value)} aria-invalid={!!errors[f]} />}
            {f === "params.course_id" && (
              <select id={id} value={(v as string) ?? ""} onChange={(e) => set(f, e.target.value)} aria-invalid={!!errors[f]}>
                <option value="">과목 선택</option>
                {catalog.courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.id})
                  </option>
                ))}
              </select>
            )}
            {f === "params.days" && (
              <div className="days" role="group" aria-label={LABEL[f]}>
                {DAYS.map((d: Day, i) => (
                  <label key={d}>
                    <input id={i === 0 ? id : undefined} type="checkbox" checked={((v as string[]) ?? []).includes(d)} onChange={(e) => toggle(f, d, e.target.checked)} />
                    {DAY_KO[d]}
                  </label>
                ))}
              </div>
            )}
            {f === "params.category_ids" && (
              <div className="row" role="group" aria-label={LABEL[f]}>
                {allCategoryIds(catalog).map((c, i) => (
                  <label key={c} className="check">
                    <input id={i === 0 ? id : undefined} type="checkbox" checked={((v as string[]) ?? []).includes(c)} onChange={(e) => toggle(f, c, e.target.checked)} />
                    {c}
                  </label>
                ))}
              </div>
            )}
            {f === "params.instructor_ids" && (
              <select id={id} multiple size={4} value={(v as string[]) ?? []} onChange={(e) => set(f, [...e.target.selectedOptions].map((o) => o.value))}>
                {catalog.instructors.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.id})
                  </option>
                ))}
              </select>
            )}
            {err(f)}
          </div>
        );
      })}
      {err("_")}
      <div className="row">
        <Button size="sm" onClick={submit} data-testid={`${testIdPrefix}-apply`}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel} data-testid={`${testIdPrefix}-cancel`}>
            {cancelLabel ?? "취소"}
          </Button>
        )}
      </div>
    </div>
  );
}
