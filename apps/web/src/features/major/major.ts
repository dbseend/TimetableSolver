/**
 * 내 전공 학점 기준(로컬 결정, 순수 함수).
 *
 * 원칙
 * - 이수구분(전필·전선)은 '전공 유형'일 뿐이며, 학생 개인의 전공 인정 기준과 같다고 가정하지 않는다.
 * - 개설 소속(학부)도 전공 인정 기준과 같다고 가정하지 않는다. 후보를 좁히는 보조 정보로만 쓴다.
 * - 사용자가 과목 목록을 직접 확인한 경우에만 그 과목들에 `내전공` 분류를 붙여 category_min에 쓸 수 있게 한다.
 * - 확인 전에는 전공 유형 이수구분을 직접 쓰는 최소 학점 조건을 막는다(다른 기능은 계속 사용).
 * API 계약은 바꾸지 않는다: 확인된 과목에 category id를 하나 더 붙인 Catalog를 서버가 다시 검증한다.
 */
import type { Catalog, Constraint } from "../../lib/types";
import { sectionCategories } from "../../lib/catalog";

export const MY_MAJOR_CATEGORY = "내전공";
export const MY_MAJOR_GROUP = "내 전공";

export interface MajorDefinition {
  /** 사용자가 확인한 과목 ID 목록(이 목록이 기준이다). */
  courseIds: string[];
  /** 후보를 좁힐 때 쓴 개설 소속·이수구분(기록용, 판정에는 쓰지 않음). */
  orgs: string[];
  types: string[];
  confirmedAt: string;
}

/** 개설 소속·전공 유형으로 좁힌 후보(확인 전 제안일 뿐). 분반 중 하나라도 유효 이수구분이 전공 유형이면 후보. */
export function majorCandidates(catalog: Catalog, courseOrgs: Record<string, string>, orgs: string[], types: string[]): string[] {
  return catalog.courses
    .filter((c) => orgs.length === 0 || orgs.includes(courseOrgs[c.id] ?? ""))
    .filter((c) => catalog.sections.some((s) => s.course_id === c.id && sectionCategories(catalog, s).some((x) => types.includes(x))))
    .map((c) => c.id)
    .sort();
}

/** 과목 안에서 '내 전공'이 되는 분반(유효 이수구분이 선택한 전공 유형인 분반). 예: 전선/교선 분반이 섞인 과목의 교선 분반은 제외. */
export function majorSections(catalog: Catalog, courseId: string, types: string[]): string[] {
  return catalog.sections.filter((s) => s.course_id === courseId && sectionCategories(catalog, s).some((x) => types.includes(x))).map((s) => s.id);
}

/**
 * 확인된 과목에 `내전공` 분류와 `내 전공` 그룹을 붙인다. 이전 설정은 지운다.
 * 분반별 이수구분(0008)과 충돌하지 않도록 **분반 단위**로 적용한다:
 * - 분반 값이 있으면 그 분반 값에만 붙인다(분반 값이 과목 값을 대체하므로 과목에만 붙이면 빠진다).
 * - 분반 값이 없으면 과목 값을 상속하므로, 과목 값이 전공 유형일 때만 과목에 붙인다.
 */
export function applyMajor(catalog: Catalog, courseIds: string[], types: string[]): Catalog {
  const set = new Set(courseIds);
  const base = clearMajor(catalog);
  const add = (cats: string[]) => (cats.includes(MY_MAJOR_CATEGORY) ? cats : [...cats, MY_MAJOR_CATEGORY]);
  const qualifies = (cats: string[]) => cats.some((x) => types.includes(x));
  return {
    ...base,
    courses: base.courses.map((c) => (set.has(c.id) && qualifies(c.category_ids) ? { ...c, category_ids: add(c.category_ids) } : c)),
    sections: base.sections.map((s) => (set.has(s.course_id) && s.category_ids != null && qualifies(s.category_ids) ? { ...s, category_ids: add(s.category_ids) } : s)),
    category_groups: { ...base.category_groups, [MY_MAJOR_GROUP]: [MY_MAJOR_CATEGORY] },
  };
}

export function clearMajor(catalog: Catalog): Catalog {
  const groups = { ...catalog.category_groups };
  delete groups[MY_MAJOR_GROUP];
  const strip = (cats: string[]) => cats.filter((x) => x !== MY_MAJOR_CATEGORY);
  return {
    ...catalog,
    courses: catalog.courses.map((c) => (c.category_ids.includes(MY_MAJOR_CATEGORY) ? { ...c, category_ids: strip(c.category_ids) } : c)),
    sections: catalog.sections.map((s) => (s.category_ids?.includes(MY_MAJOR_CATEGORY) ? { ...s, category_ids: strip(s.category_ids) } : s)),
    category_groups: groups,
  };
}

/** `내전공` 분류를 참조하는 조건 ID(전공 설정 해제 시 함께 지워야 함). */
export function constraintsUsingMyMajor(cs: Constraint[]): string[] {
  return cs.filter((c) => c.type === "category_min" && (c.params as { category_ids: string[] }).category_ids.includes(MY_MAJOR_CATEGORY)).map((c) => c.id);
}

/**
 * 전공 유형 이수구분(예: 전필·전선)을 직접 쓰는 최소 학점 조건은 '내 전공' 기준이 확인되지 않은 것으로 보고 막는다.
 * 학부와 관계없이 모든 전필·전선을 내 전공으로 세는 계산을 조용히 실행하지 않기 위함.
 */
export function majorConstraintProblem(cs: Constraint[], majorTypeCategories: string[], major: MajorDefinition | null): string | null {
  if (!majorTypeCategories.length) return null;
  const bad = cs.filter((c) => c.type === "category_min" && (c.params as { category_ids: string[] }).category_ids.some((x) => majorTypeCategories.includes(x)));
  if (!bad.length) return null;
  return major
    ? `전공 유형(${majorTypeCategories.join("·")})을 직접 쓴 학점 조건 ${bad.length}개는 학부와 관계없이 모든 과목을 셉니다. '${MY_MAJOR_GROUP}' 분류로 바꾸거나 지워 주세요.`
    : `‘내 전공 최소 학점’은 내 전공 과목을 확인해야 쓸 수 있어요. ‘내 전공 과목 정하기’에서 확인하거나 이 조건 ${bad.length}개를 지워 주세요.`;
}
