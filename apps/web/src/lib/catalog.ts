/** 분반별 유효 학점·이수구분(docs/decisions/0008). 서버 CatalogIndex.units_of/categories_of와 같은 규칙. */
import type { Catalog, Section } from "./types";

export function sectionUnits(catalog: Catalog, s: Section): number {
  return s.credit_units ?? catalog.courses.find((c) => c.id === s.course_id)?.credit_units ?? 0;
}

export function sectionCategories(catalog: Catalog, s: Section): string[] {
  return s.category_ids ?? catalog.courses.find((c) => c.id === s.course_id)?.category_ids ?? [];
}

/** 과목·분반에 쓰인 모든 분류 id(분반에만 있는 분류 포함). */
export function allCategoryIds(catalog: Catalog): string[] {
  return [...new Set([...catalog.courses.flatMap((c) => c.category_ids), ...catalog.sections.flatMap((s) => s.category_ids ?? [])])].sort();
}

/** 과목의 분반별 값이 서로 다른지(표시용). */
export function sectionVariation(catalog: Catalog, courseId: string): { units: number[]; categories: string[][] } {
  const secs = catalog.sections.filter((s) => s.course_id === courseId);
  return {
    units: [...new Set(secs.map((s) => sectionUnits(catalog, s)))].sort((a, b) => a - b),
    categories: [...new Map(secs.map((s) => [sectionCategories(catalog, s).join("|"), sectionCategories(catalog, s)])).values()],
  };
}
