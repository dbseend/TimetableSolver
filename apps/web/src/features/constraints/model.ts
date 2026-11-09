/** 조건 표시·자연어 초안 처리(순수 함수). 확정 Constraint 생성은 사용자 확인 단계에서만 한다. */
import type { Catalog, Constraint, ConstraintType, DraftConstraint, ParseRequest } from "../../lib/types";
import { DAY_KO } from "../../lib/types";
import { fmtCredits, fmtMin } from "../../lib/time";
import { allCategoryIds, sectionCategories } from "../../lib/catalog";

export const TYPE_LABEL: Record<ConstraintType, string> = {
  credit_range: "학점 범위",
  must_include: "필수 과목",
  must_exclude: "제외 과목",
  day_off: "공강 요일",
  time_avoid: "시간대 회피",
  category_min: "분류별 최소 학점",
  instructor_avoid: "교수 회피",
  max_days_on_campus: "최대 등교일",
};

export const SUPPORTED_TYPES = Object.keys(TYPE_LABEL) as ConstraintType[];

export function describe(c: { type: string; params: Record<string, unknown> }, catalog: Catalog | null): string {
  const p = c.params as Record<string, never>;
  const courseName = (id: string | null) => (id ? (catalog?.courses.find((x) => x.id === id)?.name ?? id) + ` (${id})` : "미정");
  const instName = (id: string) => catalog?.instructors.find((x) => x.id === id)?.name ?? id;
  const days = (d: string[] | null) => (d ? d.map((x) => DAY_KO[x as keyof typeof DAY_KO] ?? x).join("·") : "미정");
  const t = (m: number | null) => (m === null || m === undefined ? "미정" : fmtMin(m));
  switch (c.type) {
    case "credit_range":
      return `총 ${p.min_units == null ? "미정" : fmtCredits(p.min_units)}~${p.max_units == null ? "미정" : fmtCredits(p.max_units)}학점`;
    case "must_include": {
      const secs = p.allowed_section_ids as string[] | null;
      const labels = secs?.map((s) => catalog?.sections.find((x) => x.id === s)?.section_label ?? s);
      return `${courseName(p.course_id)} 꼭 듣기${labels ? ` (분반 ${labels.join(", ")} 중)` : ""}`;
    }
    case "must_exclude":
      return `${courseName(p.course_id)} 빼기`;
    case "day_off":
      return (p.days as string[] | null)?.length === 1 ? `${days(p.days)}요일 공강` : `${days(p.days)}요일 모두 공강`;
    case "time_avoid":
      return `${days(p.days)} ${t(p.start_minute)}~${t(p.end_minute)}와 겹치는 수업 피하기`;
    case "category_min":
      return `${p.category_ids ? (p.category_ids as string[]).join("·") : "분류 미정"} 합계 ${p.min_units == null ? "미정" : fmtCredits(p.min_units)}학점 이상`;
    case "instructor_avoid":
      return `${p.instructor_ids ? (p.instructor_ids as string[]).map(instName).join(", ") : "미정"} 교수 수업 피하기`;
    case "max_days_on_campus":
      return `등교일 주 ${p.max_days ?? "미정"}일 이하`;
    default:
      return c.type;
  }
}

export const STRENGTH_LABEL = { hard: "꼭 지키기", soft: "가능하면" } as const;

/** 질문 선택지 patch 적용. 'params.x' 키는 params에, 그 외는 최상위에. 처리한 field는 미해결 목록에서 제거. */
export function applyPatch(d: DraftConstraint, field: string, patch: Record<string, unknown> | null | undefined): DraftConstraint | null {
  if (patch && patch.discard) return null;
  const next: DraftConstraint = { ...d, params: { ...d.params }, unresolved_fields: [...d.unresolved_fields] };
  const resolved = new Set([field]);
  if (field === "params.time_window") ["params.start_minute", "params.end_minute"].forEach((f) => resolved.add(f));
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (k.startsWith("params.")) {
      next.params[k.slice(7)] = v;
      if (v !== null) resolved.add(k);
    } else {
      (next as unknown as Record<string, unknown>)[k] = v;
      if (v !== null) resolved.add(k);
    }
  }
  next.unresolved_fields = next.unresolved_fields.filter((f) => !resolved.has(f));
  return next;
}

export function isResolved(d: DraftConstraint): boolean {
  if (d.unresolved_fields.length) return false;
  if (d.action === "delete") return !!d.target_constraint_id;
  if (!d.strength || !SUPPORTED_TYPES.includes(d.type as ConstraintType)) return false;
  return Object.entries(d.params).every(([k, v]) => v !== null || k === "allowed_section_ids");
}

const PARAM_KEYS: Record<ConstraintType, string[]> = {
  credit_range: ["min_units", "max_units"],
  must_include: ["course_id", "allowed_section_ids"],
  must_exclude: ["course_id"],
  day_off: ["days"],
  time_avoid: ["days", "start_minute", "end_minute"],
  category_min: ["category_ids", "min_units"],
  instructor_avoid: ["instructor_ids"],
  max_days_on_campus: ["max_days"],
};

/** 해결된 추가 초안 → 확정 Constraint. 미해결이면 null. */
export function draftToConstraint(d: DraftConstraint, id: string): Constraint | null {
  if (d.action !== "add" || !isResolved(d)) return null;
  const type = d.type as ConstraintType;
  const params: Record<string, unknown> = {};
  for (const k of PARAM_KEYS[type]) params[k] = d.params[k] ?? null;
  if (type === "must_include" && params.allowed_section_ids === undefined) params.allowed_section_ids = null;
  const strength = d.strength!;
  return { id, type, strength, weight: strength === "soft" ? (d.weight ?? 5) : null, params } as Constraint;
}

/** 파싱 요청용 최소 엔티티(이름·ID·분반 ID). 이수내역은 포함하지 않는다. */
export function buildEntities(catalog: Catalog): ParseRequest["entities"] {
  const coursesSecs = new Map<string, string[]>();
  for (const s of catalog.sections) coursesSecs.set(s.course_id, [...(coursesSecs.get(s.course_id) ?? []), s.id]);
  return {
    // 과목 분류 = 과목 값 ∪ 분반별 값(분반마다 이수구분이 다른 과목도 해석기가 모든 분류를 알도록)
    courses: catalog.courses.map((c) => ({
      id: c.id,
      name: c.name,
      category_ids: [...new Set([...c.category_ids, ...catalog.sections.filter((s) => s.course_id === c.id).flatMap((s) => sectionCategories(catalog, s))])],
      section_ids: coursesSecs.get(c.id) ?? [],
    })),
    instructors: catalog.instructors.map((i) => {
      const secs = catalog.sections.filter((s) => s.instructor_ids.includes(i.id));
      return { id: i.id, name: i.name, course_ids: [...new Set(secs.map((s) => s.course_id))], section_ids: secs.map((s) => s.id) };
    }),
    category_groups: catalog.category_groups,
    category_ids: allCategoryIds(catalog),
  };
}

export function hardCreditRangeProblem(cs: Constraint[]): string | null {
  const hard = cs.filter((c) => c.type === "credit_range" && c.strength === "hard");
  if (hard.length === 0) return "hard 학점 범위 조건이 하나 필요합니다(최소 학점 > 0).";
  if (hard.length > 1) return "hard 학점 범위는 하나만 둘 수 있습니다. 하나로 합쳐 주세요.";
  if ((hard[0].params as { min_units: number }).min_units <= 0) return "hard 학점 범위의 최소 학점은 0보다 커야 합니다.";
  return null;
}
