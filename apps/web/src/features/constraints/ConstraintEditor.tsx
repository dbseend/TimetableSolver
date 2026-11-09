import { useState } from "react";
import type { Catalog, Constraint, ConstraintType, Day } from "../../lib/types";
import { DAY_KO, DAYS } from "../../lib/types";
import { creditToUnits, parseHHMM } from "../../lib/time";
import { allCategoryIds } from "../../lib/catalog";
import { Badge, Button, IconButton } from "../../ui";
import { describe, STRENGTH_LABEL, SUPPORTED_TYPES, TYPE_LABEL } from "./model";
import { DraftForm } from "../review/DraftForm";
import type { ConstraintMeta } from "../review/review";

type NewConstraint = Omit<Constraint, "id">;

function WeightSelect({ value, onChange, id }: { value: number; onChange: (w: number) => void; id: string }) {
  return (
    <label className="row xs muted" htmlFor={id}>
      중요도
      <select id={id} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ minHeight: 32, padding: "4px 8px" }}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((w) => (
          <option key={w} value={w}>
            {w}
          </option>
        ))}
      </select>
    </label>
  );
}

const EDIT_FIELDS: Record<ConstraintType, string[]> = {
  credit_range: ["params.min_units", "params.max_units"],
  must_include: ["params.course_id"],
  must_exclude: ["params.course_id"],
  day_off: ["params.days"],
  time_avoid: ["params.days", "params.start_minute", "params.end_minute"],
  category_min: ["params.category_ids", "params.min_units"],
  instructor_avoid: ["params.instructor_ids"],
  max_days_on_campus: ["params.max_days"],
};

/**
 * 하나의 조건 목록: '반영 완료' 조건(그 자리에서 수정·삭제)과 '지원하지 않아 제외한 요구'.
 * '확인 필요' 조건은 생성 버튼 바로 위 '확인할 조건'에 있다. 변경하면 이전 결과는 지워지고 다시 만들어야 한다(상위 reducer).
 */
export function ConstraintList({
  constraints,
  catalog,
  meta,
  excluded,
  onRemove,
  onReplace,
}: {
  constraints: Constraint[];
  catalog: Catalog | null;
  meta?: Record<string, ConstraintMeta>;
  excluded?: { source_text: string; message: string }[];
  onRemove: (id: string) => void;
  onReplace: (c: Constraint) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  if (!constraints.length && !excluded?.length) return <p className="small muted">아직 조건이 없어요. 총 학점 범위는 꼭 하나 필요합니다.</p>;
  return (
    <>
      <ul className="ccards" data-testid="constraint-list">
        {constraints.map((c) => {
          const sentence = describe(c, catalog);
          const m = meta?.[c.id];
          return (
            <li key={c.id} className={`ccard ${c.strength}`} data-testid={`constraint-${c.id}`}>
              <div className="top">
                <div className="sentence">
                  <div className="kind">
                    <span className="ok">✓ 반영 완료</span> · {TYPE_LABEL[c.type]}
                    {m?.origin === "nl" && m.source_text && <> · 문장 “{m.source_text}”에서</>}
                    {m?.suggested && <span className="badge warning" style={{ marginLeft: 4 }}>기본 제안값</span>}
                  </div>
                  {sentence}
                </div>
                <div className="actions">
                  {catalog && (
                    <IconButton icon="edit" label={`수정: ${sentence}`} onClick={() => setEditing(editing === c.id ? null : c.id)} aria-expanded={editing === c.id} />
                  )}
                  <IconButton icon="trash" label={`삭제: ${sentence}`} variant="danger-ghost" onClick={() => onRemove(c.id)} />
                </div>
              </div>
              {editing === c.id && catalog ? (
                <div style={{ marginTop: 10 }} data-testid={`edit-${c.id}`}>
                  <DraftForm
                    catalog={catalog}
                    draft={{ draft_id: c.id, type: c.type, strength: c.strength, weight: c.weight ?? null, params: c.params as Record<string, unknown>, source_text: m?.source_text ?? "", unresolved_fields: [], action: "add", target_constraint_id: null }}
                    fields={EDIT_FIELDS[c.type]}
                    editAll
                    submitLabel="수정 반영"
                    testIdPrefix={`edit-${c.id}`}
                    onSubmit={(d) => {
                      const params = { ...(d.params as Record<string, unknown>) };
                      if (c.type === "must_include" && params.course_id !== (c.params as { course_id: string }).course_id) params.allowed_section_ids = null;
                      onReplace({ ...c, strength: d.strength!, weight: d.strength === "soft" ? (d.weight ?? 5) : null, params } as Constraint);
                      setEditing(null);
                    }}
                    onCancel={() => setEditing(null)}
                  />
                </div>
              ) : (
                <div className="foot">
                  <div className="row" role="group" aria-label="지키는 정도">
                    {(["hard", "soft"] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        className="toggle"
                        aria-pressed={c.strength === s}
                        onClick={() => c.strength !== s && onReplace({ ...c, strength: s, weight: s === "soft" ? 5 : null } as Constraint)}
                      >
                        {STRENGTH_LABEL[s]}
                      </button>
                    ))}
                  </div>
                  {c.strength === "soft" && <WeightSelect id={`w-${c.id}`} value={c.weight ?? 5} onChange={(w) => onReplace({ ...c, weight: w } as Constraint)} />}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {!!excluded?.length && (
        <ul className="ccards" data-testid="excluded-list" style={{ marginTop: 8 }}>
          {excluded.map((u, i) => (
            <li key={i} className="ccard" style={{ borderStyle: "dashed" }}>
              <div className="kind">지원하지 않는 조건 · 제외됨</div>
              <span className="small">
                “{u.source_text}” — {u.message}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function DayPicker({ value, onChange, testId }: { value: Day[]; onChange: (d: Day[]) => void; testId?: string }) {
  return (
    <div className="days" data-testid={testId} role="group" aria-label="요일">
      {DAYS.map((d) => (
        <label key={d}>
          <input type="checkbox" checked={value.includes(d)} onChange={(e) => onChange(e.target.checked ? DAYS.filter((x) => x === d || value.includes(x)) : value.filter((x) => x !== d))} />
          {DAY_KO[d]}
        </label>
      ))}
    </div>
  );
}

/** 직접 조건 추가 폼. 입력값은 검증 후 정수 분/credit_units로 변환한다(추측하지 않음). */
export function ConstraintForm({ catalog, onAdd }: { catalog: Catalog; onAdd: (c: NewConstraint) => void }) {
  const [type, setType] = useState<ConstraintType>("day_off");
  const [strength, setStrength] = useState<"hard" | "soft">("hard");
  const [weight, setWeight] = useState(5);
  const [days, setDays] = useState<Day[]>([]);
  const [minC, setMinC] = useState("15");
  const [maxC, setMaxC] = useState("18");
  const [course, setCourse] = useState("");
  const [sections, setSections] = useState<string[]>([]);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [cats, setCats] = useState<string[]>([]);
  const [insts, setInsts] = useState<string[]>([]);
  const [maxDays, setMaxDays] = useState("4");
  const [error, setError] = useState<string | null>(null);

  const categoryIds = allCategoryIds(catalog);
  const courseSections = catalog.sections.filter((s) => s.course_id === course);

  function build(): NewConstraint | string {
    let params: Record<string, unknown>;
    switch (type) {
      case "credit_range": {
        const lo = creditToUnits(minC);
        const hi = creditToUnits(maxC);
        if (lo === null || hi === null) return "학점은 0.01 단위 숫자로 입력하세요.";
        if (lo > hi) return "최소 학점이 최대 학점보다 큽니다.";
        params = { min_units: lo, max_units: hi };
        break;
      }
      case "must_include":
        if (!course) return "과목을 고르세요.";
        params = { course_id: course, allowed_section_ids: sections.length ? sections : null };
        break;
      case "must_exclude":
        if (!course) return "과목을 고르세요.";
        params = { course_id: course };
        break;
      case "day_off":
        if (!days.length) return "요일을 고르세요.";
        params = { days };
        break;
      case "time_avoid": {
        const s = parseHHMM(start, false);
        const e = parseHHMM(end, true);
        if (!days.length) return "요일을 고르세요.";
        if (s === null || e === null || s >= e) return "시작 < 종료인 HH:MM 시각을 입력하세요.";
        params = { days, start_minute: s, end_minute: e };
        break;
      }
      case "category_min": {
        const lo = creditToUnits(minC);
        if (!cats.length) return "분류를 고르세요.";
        if (lo === null || lo <= 0) return "최소 학점은 0보다 커야 합니다.";
        params = { category_ids: cats, min_units: lo };
        break;
      }
      case "instructor_avoid":
        if (!insts.length) return "교수를 고르세요.";
        params = { instructor_ids: insts };
        break;
      case "max_days_on_campus": {
        const n = Number(maxDays);
        if (!Number.isInteger(n) || n < 0 || n > 7) return "0~7 사이 정수를 입력하세요.";
        params = { max_days: n };
        break;
      }
    }
    return { type, strength, weight: strength === "soft" ? weight : null, params } as NewConstraint;
  }

  function submit() {
    const r = build();
    if (typeof r === "string") return setError(r);
    setError(null);
    onAdd(r);
  }

  return (
    <div className="stack" data-testid="constraint-form">
      <div className="form-grid">
        <label className="field">
          조건 종류
          <select value={type} onChange={(e) => setType(e.target.value as ConstraintType)} data-testid="ctype">
            {SUPPORTED_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          지키는 정도
          <select value={strength} onChange={(e) => setStrength(e.target.value as "hard" | "soft")} data-testid="cstrength">
            <option value="hard">꼭 지키기</option>
            <option value="soft">가능하면</option>
          </select>
        </label>
        {strength === "soft" && <WeightSelect id="new-weight" value={weight} onChange={setWeight} />}
      </div>

      {(type === "credit_range" || type === "category_min") && (
        <div className="form-grid">
          <label className="field">
            최소 학점
            <input className="num" inputMode="decimal" value={minC} onChange={(e) => setMinC(e.target.value)} data-testid="cmin" />
          </label>
          {type === "credit_range" && (
            <label className="field">
              최대 학점
              <input className="num" inputMode="decimal" value={maxC} onChange={(e) => setMaxC(e.target.value)} data-testid="cmax" />
            </label>
          )}
        </div>
      )}
      {(type === "must_include" || type === "must_exclude") && (
        <label className="field">
          과목
          <select
            value={course}
            onChange={(e) => {
              setCourse(e.target.value);
              setSections([]);
            }}
            data-testid="ccourse"
          >
            <option value="">과목 선택</option>
            {catalog.courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.id})
              </option>
            ))}
          </select>
        </label>
      )}
      {type === "must_include" && courseSections.length > 0 && (
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small muted">분반 제한 (고르지 않으면 아무 분반)</legend>
          <div className="row">
            {courseSections.map((s) => (
              <label key={s.id} className="check">
                <input
                  type="checkbox"
                  checked={sections.includes(s.id)}
                  onChange={(e) => setSections(e.target.checked ? [...sections, s.id] : sections.filter((x) => x !== s.id))}
                />
                {s.section_label}분반{s.support_status !== "supported" && " (미지원)"}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {(type === "day_off" || type === "time_avoid") && <DayPicker value={days} onChange={setDays} testId="cdays" />}
      {type === "time_avoid" && (
        <div className="form-grid">
          <label className="field">
            시작
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} data-testid="cstart" />
          </label>
          <label className="field">
            종료
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} data-testid="cend" />
          </label>
        </div>
      )}
      {type === "category_min" && (
        <div className="stack">
          {Object.keys(catalog.category_groups).length > 0 && (
            <div className="row">
              {Object.entries(catalog.category_groups).map(([g, ids]) => (
                <Button key={g} variant="secondary" size="sm" onClick={() => setCats(ids)}>
                  그룹 '{g}' 선택 ({ids.join("+")})
                </Button>
              ))}
            </div>
          )}
          <div className="row">
            {categoryIds.map((c) => (
              <label key={c} className="check">
                <input type="checkbox" checked={cats.includes(c)} onChange={(e) => setCats(e.target.checked ? [...cats, c] : cats.filter((x) => x !== c))} />
                {c}
              </label>
            ))}
          </div>
          {catalog.data_origin === "user_import" && <p className="xs muted">분류는 개설 학부와 관계없이 모든 해당 과목을 셉니다.</p>}
        </div>
      )}
      {type === "instructor_avoid" && (
        <label className="field">
          교수 (여러 명 선택 가능)
          <select multiple value={insts} onChange={(e) => setInsts([...e.target.selectedOptions].map((o) => o.value))} size={5}>
            {catalog.instructors.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({i.id})
              </option>
            ))}
          </select>
        </label>
      )}
      {type === "max_days_on_campus" && (
        <label className="field">
          주 최대 등교일
          <input className="num" inputMode="numeric" value={maxDays} onChange={(e) => setMaxDays(e.target.value)} />
        </label>
      )}
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      <div>
        <Button variant="secondary" onClick={submit} data-testid="cadd">
          조건 추가
        </Button>
      </div>
    </div>
  );
}

export function ConfirmBadge({ confirmed }: { confirmed: boolean }) {
  return confirmed ? <Badge tone="success">✓ 확인 완료</Badge> : <Badge tone="warning">확인 필요</Badge>;
}
