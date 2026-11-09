/** 내 전공 기준·분반별 차이 반례. 실제 학교 데이터가 아니라 같은 모양의 합성 데이터만 쓴다. */
import { describe, expect, it } from "vitest";
import type { Constraint } from "../../src/lib/types";
import { type AdapterConfig, importCatalog, parsePeriodTables } from "../../src/features/catalog/adapter";
import { PORTAL_ADAPTER_BASE, PORTAL_PERIOD_TABLE_TEXT } from "../../src/features/catalog/presets";
import { applyMajor, clearMajor, constraintsUsingMyMajor, majorCandidates, majorConstraintProblem, MY_MAJOR_CATEGORY, MY_MAJOR_GROUP } from "../../src/features/major/major";

const t = parsePeriodTables(PORTAL_PERIOD_TABLE_TEXT);
const cfg: AdapterConfig = { ...PORTAL_ADAPTER_BASE, catalogId: "syn", termId: "2026-2", dataOrigin: "user_import", periodTable: t.common, periodTableByDay: t.byDay };
const H = ["구분", "과목코드", "분반", "과목명(CourseName)", "학점", "개설정보", "시간(Period)", "강의실"];
const row = (cat: string, code: string, sec: string, credit: string, org: string, time: string) => [cat, code, sec, `${code}과목\n(EN)`, credit, `${org} 주간\n교수${sec}`, time, "R1"];

// 서로 다른 학부가 같은 이수구분(전선)을 쓰는 합성 카탈로그
const rows = [
  H,
  row("전선", "AAA101", "01", "3", "가학부", "월1,목1"),
  row("전필", "AAA201", "01", "3", "가학부", "화1,금1"),
  row("전선", "BBB101", "01", "3", "나학부", "월2,목2"),
  row("교선", "GEN101", "01", "2", "교양학부", "수2"),
];
const imp = importCatalog(rows, cfg);
const catalog = imp.catalog!;

const cmin = (id: string, cats: string[], min = 300): Constraint => ({ id, type: "category_min", strength: "hard", weight: null, params: { category_ids: cats, min_units: min } });

describe("개설 소속 기록과 전공 유형", () => {
  it("records offering org per course locally (not part of the Catalog contract)", () => {
    expect(imp.courseOrgs).toEqual({ AAA101: "가학부 주간", AAA201: "가학부 주간", BBB101: "나학부 주간", GEN101: "교양학부 주간" });
    expect(JSON.stringify(catalog)).not.toContain("가학부"); // 서버로 가는 Catalog에는 넣지 않음
  });
  it("portal preset no longer creates an automatic '전공' group", () => {
    expect(catalog.category_groups).toEqual({});
  });
  it("전선 category spans multiple orgs — so it is not 'my major'", () => {
    const withJunSeon = catalog.courses.filter((c) => c.category_ids.includes("전선")).map((c) => imp.courseOrgs[c.id]);
    expect(new Set(withJunSeon).size).toBe(2);
  });
});

describe("내 전공 최소 학점 차단", () => {
  const types = ["전필", "전선"];
  it("blocks category_min on major-type categories until a major is confirmed", () => {
    expect(majorConstraintProblem([cmin("c2", ["전필", "전선"])], types, null)).toMatch(/내 전공 과목을 확인/);
  });
  it("does not block other conditions (generation stays available)", () => {
    expect(majorConstraintProblem([cmin("c2", ["교선"])], types, null)).toBeNull();
    expect(majorConstraintProblem([], types, null)).toBeNull();
  });
  it("still blocks raw major-type categories after confirmation, but allows the confirmed '내전공' category", () => {
    const major = { courseIds: ["AAA101"], orgs: [], types, confirmedAt: "x" };
    expect(majorConstraintProblem([cmin("c2", ["전선"])], types, major)).toMatch(/학부와 관계없이/);
    expect(majorConstraintProblem([cmin("c2", [MY_MAJOR_CATEGORY])], types, major)).toBeNull();
  });
  it("no major-type categories marked (e.g. demo) → no block", () => {
    expect(majorConstraintProblem([cmin("c2", ["major_required"])], [], null)).toBeNull();
  });
});

describe("확인된 과목만 '내전공' 분류", () => {
  it("candidates are narrowed by org and type, but only confirmed courses get the category", () => {
    expect(majorCandidates(catalog, imp.courseOrgs, ["가학부 주간"], ["전필", "전선"])).toEqual(["AAA101", "AAA201"]);
    const applied = applyMajor(catalog, ["AAA101"]); // 사용자가 AAA201을 빼고 확인
    expect(applied.courses.find((c) => c.id === "AAA101")!.category_ids).toEqual(["전선", MY_MAJOR_CATEGORY]);
    expect(applied.courses.find((c) => c.id === "AAA201")!.category_ids).toEqual(["전필"]);
    expect(applied.courses.find((c) => c.id === "BBB101")!.category_ids).toEqual(["전선"]);
    expect(applied.category_groups).toEqual({ [MY_MAJOR_GROUP]: [MY_MAJOR_CATEGORY] });
  });
  it("re-apply replaces, clear removes, and dependent constraints are identified", () => {
    const twice = applyMajor(applyMajor(catalog, ["AAA101"]), ["BBB101"]);
    expect(twice.courses.filter((c) => c.category_ids.includes(MY_MAJOR_CATEGORY)).map((c) => c.id)).toEqual(["BBB101"]);
    expect(clearMajor(twice)).toEqual(catalog);
    expect(constraintsUsingMyMajor([cmin("c2", [MY_MAJOR_CATEGORY]), cmin("c3", ["교선"])])).toEqual(["c2"]);
  });
});

describe("분반별 학점·이수구분 차이 (제외된 7과목과 같은 모양의 합성 반례)", () => {
  it("variable credit per section (예: 현장실습 2/6학점) → 현재 모델은 과목째 제외", () => {
    const r = importCatalog([H, row("자선", "VAR101", "01", "6", "가학부", ""), row("자선", "VAR101", "02", "2", "가학부", "")], cfg);
    expect(r.issues.some((i) => i.code === "COURSE_INCONSISTENT")).toBe(true);
    expect(r.catalog).toBeNull(); // 다른 과목이 없으므로 가져올 분반 0
  });
  it("per-section 이수구분 (전선/전필) with real class times → 시간이 있는 정상 분반도 잃는다", () => {
    const r = importCatalog([H, row("전선", "MIX101", "01", "3", "가학부", "월1,목1"), row("전필", "MIX101", "02", "3", "가학부", "화1,금1"), row("교선", "GEN101", "01", "2", "교양학부", "수2")], cfg);
    expect(r.issues.some((i) => i.code === "COURSE_INCONSISTENT")).toBe(true);
    expect(r.catalog!.sections.some((s) => s.course_id === "MIX101")).toBe(false);
  });
});
