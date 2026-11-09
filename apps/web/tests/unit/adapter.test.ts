import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDelimited } from "../../src/features/catalog/csv";
import { type AdapterConfig, DEMO_ADAPTER, EXAMPLE_PERIOD_TABLE, guessColumns, guessTimeMode, importCatalog, parsePeriodTables } from "../../src/features/catalog/adapter";

const demo = readFileSync(new URL("../../../../fixtures/catalogs/demo-campus-2026-2.csv", import.meta.url), "utf-8");

describe("demo CSV → Catalog (same adapter path as school CSV)", () => {
  const r = importCatalog(parseDelimited(demo), DEMO_ADAPTER);
  const cat = r.catalog!;
  const sec = (id: string) => cat.sections.find((s) => s.id === id)!;

  it("imports courses and sections", () => {
    expect(cat).not.toBeNull();
    expect(cat.courses.length).toBe(19);
    expect(cat.sections.length).toBe(32);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });
  it("collects all meetings of a section from multiple rows", () => {
    expect(sec("2026-2:CSE201:01").meetings).toEqual([
      { day: "Mon", start_minute: 540, end_minute: 615, room: "N201", campus_required: true },
      { day: "Wed", start_minute: 540, end_minute: 615, room: "N201", campus_required: true },
    ]);
  });
  it("marks irregular (격주) and TBD sections unsupported instead of guessing", () => {
    expect(sec("2026-2:CSE210:02").support_status).toBe("unsupported");
    expect(sec("2026-2:CSE210:02").issue_codes).toContain("IRREGULAR_SCHEDULE");
    expect(sec("2026-2:CSE308:02").issue_codes).toEqual(["TIME_TBD"]);
    expect(sec("2026-2:CSE308:02").meetings).toEqual([]);
  });
  it("keeps async online with no meetings as supported, sync online not campus-required", () => {
    expect(sec("2026-2:GEN201:01")).toMatchObject({ delivery_mode: "online_async", meetings: [], support_status: "supported" });
    expect(sec("2026-2:CSE305:02").meetings[0].campus_required).toBe(false);
  });
  it("converts credits exactly (1.5 → 150) and maps categories", () => {
    expect(cat.courses.find((c) => c.id === "GEN205")!.credit_units).toBe(150);
    expect(cat.courses.find((c) => c.id === "CSE201")!.category_ids).toEqual(["major_required"]);
    expect(cat.category_groups).toEqual({ major: ["major_required", "major_elective"] });
  });
});

const schoolCsv = [
  "학수번호,교과목명,분반,학점,이수구분,담당교수,강의시간,강의실",
  "ABC101,회로이론,1,3,전공필수,홍교수,\"월1-2,수3\",E101",
  "ABC102,신호처리,1,3,전공선택,김교수,화5-6,E102",
  "ABC102,신호처리,2,3,전공선택,김교수,목5-6(격주),E102",
  "ABC103,논리설계,1,3,전공선택,이교수,,E103",
  "ABC104,창의설계,1,2.5,교양,박교수,금 13:00-15:30,E104",
].join("\n");

function schoolCfg(rows: string[][]): AdapterConfig {
  const columns = guessColumns(rows[0]);
  return {
    catalogId: "school-x",
    termId: "2026-2",
    dataOrigin: "user_import",
    columns,
    timeMode: guessTimeMode(columns),
    periodTable: EXAMPLE_PERIOD_TABLE,
    categoryMap: { 전공필수: "major_required", 전공선택: "major_elective" },
    categoryGroups: { major: ["major_required", "major_elective"] },
    defaultDelivery: "in_person",
  };
}

describe("school-style CSV with Korean headers and period notation", () => {
  const rows = parseDelimited(schoolCsv);
  const cfg = schoolCfg(rows);
  const r = importCatalog(rows, cfg);
  const sec = (id: string) => r.catalog!.sections.find((s) => s.id === id)!;

  it("guesses column mapping and time mode", () => {
    expect(cfg.columns).toMatchObject({ course_code: "학수번호", course_name: "교과목명", section: "분반", credit: "학점", schedule: "강의시간", room: "강의실" });
    expect(cfg.timeMode).toBe("schedule_text");
  });
  it("keeps each period's own interval (no merging, break not counted as class)", () => {
    // 예시표: 1교시 09:00-09:50, 2교시 10:00-10:50, 3교시 11:00-11:50
    expect(sec("2026-2:ABC101:1").meetings.map((m) => [m.day, m.start_minute, m.end_minute])).toEqual([
      ["Mon", 540, 590],
      ["Mon", 600, 650],
      ["Wed", 660, 710],
    ]);
  });
  it("supports HH:MM inside schedule text", () => {
    expect(sec("2026-2:ABC104:1").meetings[0]).toMatchObject({ day: "Fri", start_minute: 780, end_minute: 930 });
  });
  it("does not silently drop unparsed schedule text (격주) or missing time", () => {
    expect(sec("2026-2:ABC102:2").support_status).toBe("unsupported");
    expect(sec("2026-2:ABC102:2").issue_codes).toContain("SCHEDULE_TEXT_UNPARSED");
    expect(sec("2026-2:ABC103:1").issue_codes).toEqual(["TIME_TBD"]);
  });
  it("generates instructor ids from names with an explicit warning", () => {
    expect(sec("2026-2:ABC101:1").instructor_ids).toEqual(["name:홍교수"]);
    expect(r.issues.some((i) => i.code === "INSTRUCTOR_ID_FROM_NAME")).toBe(true);
  });
  it("unknown period number makes the section unsupported, not guessed", () => {
    const rows2 = parseDelimited("학수번호,교과목명,분반,학점,요일,교시\nX1,가,1,3,월,13-14");
    const c = { ...schoolCfg(rows2), periodTable: { "1": [540, 590] as [number, number] } };
    expect(c.timeMode).toBe("day_period");
    expect(importCatalog(rows2, c).catalog!.sections[0].issue_codes).toEqual(["PERIOD_UNKNOWN"]);
  });
});

describe("adapter errors", () => {
  it("preserves per-section credit differences instead of dropping the course (0008)", () => {
    // 분반 02의 두 행(월·수 Meeting) 모두 2학점으로 바꾼다
    const rows = parseDelimited(demo.replaceAll("CSE201,자료구조,02,3,", "CSE201,자료구조,02,2,"));
    const r = importCatalog(rows, DEMO_ADAPTER);
    expect(r.issues.some((i) => i.code === "COURSE_INCONSISTENT")).toBe(false);
    expect(r.issues.some((i) => i.code === "SECTION_VALUES_PRESERVED")).toBe(true);
    expect(r.catalog!.courses.find((c) => c.id === "CSE201")!.credit_units).toBe(300); // 동률 → 먼저 나온 분반 값
    const secs = r.catalog!.sections.filter((s) => s.course_id === "CSE201");
    expect(secs.map((s) => [s.section_label, s.credit_units, s.category_ids])).toEqual([
      ["01", null, null],
      ["02", 200, null],
    ]);
  });
  it("still refuses to merge rows whose course names differ", () => {
    const r = importCatalog(parseDelimited(demo.replace("CSE201,자료구조,02,", "CSE201,자료구조2,02,")), DEMO_ADAPTER);
    expect(r.issues.some((i) => i.code === "COURSE_INCONSISTENT")).toBe(true);
    expect(r.catalog!.courses.find((c) => c.id === "CSE201")).toBeUndefined();
  });
  it("rows of the same section with different credits make that section unsupported (which value is unknown)", () => {
    const lines = demo.split(/\r?\n/);
    const i = lines.findIndex((l) => l.startsWith("CSE201,자료구조,01,3,"));
    lines[i + 1] = lines[i + 1].replace("CSE201,자료구조,01,3,", "CSE201,자료구조,01,2,");
    const r = importCatalog(parseDelimited(lines.join("\n")), DEMO_ADAPTER);
    expect(r.catalog!.sections.find((s) => s.id === "2026-2:CSE201:01")!.issue_codes).toContain("SECTION_VALUE_INCONSISTENT");
  });
  it("rejects credits finer than 0.01", () => {
    const rows = parseDelimited(demo.replace(/GEN205,창의적사고,01,1\.5,/, "GEN205,창의적사고,01,1.505,"));
    expect(importCatalog(rows, DEMO_ADAPTER).issues.some((i) => i.code === "CREDIT_INVALID")).toBe(true);
  });
  it("fails when required columns are unmapped", () => {
    const r = importCatalog(parseDelimited(demo), { ...DEMO_ADAPTER, columns: { ...DEMO_ADAPTER.columns, credit: undefined } });
    expect(r.catalog).toBeNull();
    expect(r.issues[0].code).toBe("REQUIRED_COLUMN_UNMAPPED");
  });
  it("parses period table text and reports bad lines", () => {
    const { common, byDay, errors } = parsePeriodTables("1=09:00-09:50\n2 = 10:00 - 10:50\nbad\n3=11:00-10:00");
    expect(common).toEqual({ "1": [540, 590], "2": [600, 650] });
    expect(byDay).toEqual({});
    expect(errors).toEqual(["bad", "3=11:00-10:00"]);
  });
});

describe("line endings / BOM do not change the imported catalog (revision is a content hash)", () => {
  it("LF, CRLF and UTF-8 BOM versions of the same CSV produce identical catalogs", () => {
    const lf = importCatalog(parseDelimited(demo.replace(/\r\n/g, "\n")), DEMO_ADAPTER).catalog;
    const crlf = importCatalog(parseDelimited(demo.replace(/\r?\n/g, "\r\n")), DEMO_ADAPTER).catalog;
    const bom = importCatalog(parseDelimited("\uFEFF" + demo), DEMO_ADAPTER).catalog;
    expect(crlf).toEqual(lf);
    expect(bom).toEqual(lf);
  });
});
