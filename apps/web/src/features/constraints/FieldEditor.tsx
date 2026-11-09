/**
 * 해석 초안의 빈 필수 값을 그 자리에서 입력·선택하는 편집기.
 * 값은 검증한 뒤에만 초안에 적용하고, 모든 값이 채워져야 '조건에 추가'가 가능하다(확인·solve 차단은 기존 흐름).
 */
import { useState } from "react";
import type { Catalog, Day, DraftConstraint } from "../../lib/types";
import { DAY_KO, DAYS } from "../../lib/types";
import { creditToUnits, fmtCredits, fmtMin, parseHHMM } from "../../lib/time";
import { allCategoryIds } from "../../lib/catalog";
import { Button } from "../../ui";

export const EDITABLE_FIELDS = [
  "params.min_units",
  "params.max_units",
  "params.days",
  "params.start_minute",
  "params.end_minute",
  "params.max_days",
  "params.category_ids",
  "params.course_id",
  "params.instructor_ids",
] as const;
type Field = (typeof EDITABLE_FIELDS)[number];

const LABEL: Record<Field, string> = {
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

export function isEditable(f: string): f is Field {
  return (EDITABLE_FIELDS as readonly string[]).includes(f);
}

/** 입력값 → 패치 값. 잘못되면 오류 문자열. 다른 필드와의 관계(최소≤최대, 시작<종료)도 검사. */
export function validateFieldValue(d: DraftConstraint, field: Field, raw: string | string[]): { value: unknown } | { error: string } {
  const p = d.params as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === "number" ? x : null);
  switch (field) {
    case "params.min_units":
    case "params.max_units": {
      const u = creditToUnits(String(raw));
      if (u === null) return { error: "학점은 0.01 단위 숫자로 입력하세요." };
      if (d.type === "credit_range" && field === "params.min_units" && u <= 0) return { error: "최소 학점은 0보다 커야 합니다." };
      const lo = field === "params.min_units" ? u : num(p.min_units);
      const hi = field === "params.max_units" ? u : num(p.max_units);
      if (lo !== null && hi !== null && lo > hi) return { error: `최소 ${fmtCredits(lo)}학점이 최대 ${fmtCredits(hi)}학점보다 큽니다.` };
      return { value: u };
    }
    case "params.start_minute":
    case "params.end_minute": {
      const t = parseHHMM(String(raw), field === "params.end_minute");
      if (t === null) return { error: "HH:MM 형식으로 입력하세요." };
      const s = field === "params.start_minute" ? t : num(p.start_minute);
      const e = field === "params.end_minute" ? t : num(p.end_minute);
      if (s !== null && e !== null && s >= e) return { error: `시작(${fmtMin(s)})이 종료(${fmtMin(e)})보다 빨라야 합니다.` };
      return { value: t };
    }
    case "params.max_days": {
      const n = Number(raw);
      return Number.isInteger(n) && n >= 0 && n <= 7 ? { value: n } : { error: "0~7 사이 정수를 입력하세요." };
    }
    case "params.days":
    case "params.category_ids":
    case "params.instructor_ids": {
      const arr = Array.isArray(raw) ? raw : [];
      return arr.length ? { value: field === "params.days" ? DAYS.filter((x) => arr.includes(x)) : arr } : { error: "하나 이상 고르세요." };
    }
    case "params.course_id":
      return raw ? { value: String(raw) } : { error: "과목을 고르세요." };
  }
}

export function FieldEditor({ catalog, draft, field, onApply }: { catalog: Catalog; draft: DraftConstraint; field: Field; onApply: (value: unknown) => void }) {
  const [text, setText] = useState("");
  const [list, setList] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const id = `fe-${draft.draft_id}-${field}`;
  const isList = field === "params.days" || field === "params.category_ids" || field === "params.instructor_ids";

  function apply() {
    const r = validateFieldValue(draft, field, isList ? list : text);
    if ("error" in r) return setError(r.error);
    setError(null);
    onApply(r.value);
  }
  const toggle = (v: string, on: boolean) => setList(on ? [...list, v] : list.filter((x) => x !== v));

  return (
    <div className="question" data-testid={`field-editor-${draft.draft_id}-${field.slice(7)}`}>
      <p>
        <label htmlFor={id}>{LABEL[field]} 값이 비어 있어요. 직접 정해 주세요.</label>
      </p>
      <div className="row">
        {(field === "params.min_units" || field === "params.max_units") && (
          <input id={id} className="num" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} placeholder="예: 18" aria-label={LABEL[field]} />
        )}
        {(field === "params.start_minute" || field === "params.end_minute") && <input id={id} type="time" value={text} onChange={(e) => setText(e.target.value)} aria-label={LABEL[field]} />}
        {field === "params.max_days" && <input id={id} className="num" inputMode="numeric" value={text} onChange={(e) => setText(e.target.value)} aria-label={LABEL[field]} />}
        {field === "params.course_id" && (
          <select id={id} value={text} onChange={(e) => setText(e.target.value)} aria-label={LABEL[field]}>
            <option value="">과목 선택</option>
            {catalog.courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.id})
              </option>
            ))}
          </select>
        )}
        {field === "params.days" && (
          <div className="days" role="group" aria-label="요일">
            {DAYS.map((d: Day) => (
              <label key={d}>
                <input type="checkbox" checked={list.includes(d)} onChange={(e) => toggle(d, e.target.checked)} />
                {DAY_KO[d]}
              </label>
            ))}
          </div>
        )}
        {field === "params.category_ids" &&
          allCategoryIds(catalog).map((c) => (
            <label key={c} className="check">
              <input type="checkbox" checked={list.includes(c)} onChange={(e) => toggle(c, e.target.checked)} />
              {c}
            </label>
          ))}
        {field === "params.instructor_ids" && (
          <select id={id} multiple size={4} value={list} onChange={(e) => setList([...e.target.selectedOptions].map((o) => o.value))} aria-label={LABEL[field]}>
            {catalog.instructors.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({i.id})
              </option>
            ))}
          </select>
        )}
        <Button size="sm" variant="secondary" onClick={apply} data-testid={`field-apply-${draft.draft_id}-${field.slice(7)}`}>
          이 값으로 정하기
        </Button>
      </div>
      {error && (
        <p className="error xs" role="alert" style={{ marginTop: 6 }}>
          {error}
        </p>
      )}
    </div>
  );
}
