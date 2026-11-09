/** 포털 HTML 내보내기 형식 회귀 테스트. 실제 학교 파일이 아니라 같은 형식의 합성 파일을 쓴다. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type AdapterConfig, importCatalog, parsePeriodTables } from "../../src/features/catalog/adapter";
import { decodeTableFile, looksLikeHtml, parseHtmlTable } from "../../src/features/catalog/htmlTable";
import { matchesPortalExport, PORTAL_ADAPTER_BASE, PORTAL_PERIOD_TABLE_TEXT } from "../../src/features/catalog/presets";
import { creditToUnits } from "../../src/lib/time";

const tables = parsePeriodTables(PORTAL_PERIOD_TABLE_TEXT);
const cfg: AdapterConfig = { ...PORTAL_ADAPTER_BASE, catalogId: "syn", termId: "2026-2", dataOrigin: "user_import", periodTable: tables.common, periodTableByDay: tables.byDay };
const hhmm = (h: number, m: number) => h * 60 + m;

function one(schedule: string) {
  const rows = [["구분", "과목코드", "분반", "과목명(CourseName)", "학점", "개설정보", "시간(Period)", "강의실"], ["전선", "T1", "01", "가\n(A)", "3", "학부\n교수", schedule, "R1"]];
  return importCatalog(rows, cfg).catalog!.sections[0];
}

describe("per-day period table (user-provided school table)", () => {
  it("parses headers into weekday-specific tables, no weekend tables", () => {
    expect(tables.errors).toEqual([]);
    expect(tables.common).toEqual({});
    expect(Object.keys(tables.byDay).sort()).toEqual(["Fri", "Mon", "Thu", "Tue", "Wed"]);
  });
  it.each([
    ["월1", "Mon", hhmm(9, 0), hhmm(10, 15)],
    ["수1", "Wed", hhmm(8, 30), hhmm(9, 45)],
    ["화3", "Tue", hhmm(12, 0), hhmm(13, 15)],
    ["수3", "Wed", hhmm(11, 30), hhmm(12, 45)],
    ["금10", "Fri", hhmm(22, 30), hhmm(23, 45)],
  ])("%s → day/time", (sched, day, s, e) => {
    expect(one(sched).meetings).toEqual([{ day, start_minute: s, end_minute: e, room: "R1", campus_required: true }]);
  });
  it("consecutive periods keep each period interval; break is not class time", () => {
    expect(one("화3,화4").meetings.map((m) => [m.start_minute, m.end_minute])).toEqual([
      [hhmm(12, 0), hhmm(13, 15)],
      [hhmm(13, 30), hhmm(14, 45)],
    ]);
  });
  it("weekend periods are not guessed: section unsupported", () => {
    const s = one("토4,토5");
    expect(s.support_status).toBe("unsupported");
    expect(s.issue_codes).toEqual(["PERIOD_TABLE_MISSING_FOR_DAY"]);
    expect(s.meetings).toEqual([]);
  });
  it("header '[월요일·화요일]' does not treat 요일's 일 as Sunday", () => {
    expect(Object.keys(parsePeriodTables("[월요일·화요일]\n1=09:00-10:15").byDay).sort()).toEqual(["Mon", "Tue"]);
  });
});

describe("portal HTML export (.xls extension, CP949) — synthetic fixture", () => {
  // 의도적으로 바이트로 읽는다: CP949 인코딩 감지·디코딩을 검증하기 위함(.gitattributes에서 binary로 고정).
  const buf = readFileSync(new URL("../../../../fixtures/catalogs/synthetic-portal-export.xls", import.meta.url));
  const dec = decodeTableFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

  it("decodes CP949 via meta charset and parses the table", () => {
    expect("text" in dec).toBe(true);
    if (!("text" in dec)) return;
    expect(dec.encoding).toBe("ks_c_5601-1987");
    expect(looksLikeHtml(dec.text)).toBe(true);
    const rows = parseHtmlTable(dec.text);
    expect(rows[0]).toEqual(["구분", "과목코드", "분반", "과목명(CourseName)", "학점", "개설정보", "시간(Period)", "강의실"]);
    expect(matchesPortalExport(rows[0])).toBe(true);
    expect(rows[1][5]).toBe("가상학부 주간\n가교수"); // &nbsp; 정리, 줄 보존
  });

  it("imports with line selection, .5 credits, multi-meeting sections and exclusions", () => {
    if (!("text" in dec)) throw new Error("decode failed");
    const r = importCatalog(parseHtmlTable(dec.text), cfg);
    const c = r.catalog!;
    const sec = (code: string) => c.sections.find((s) => s.course_id === code)!;
    expect(c.courses.find((x) => x.id === "SYN101")).toMatchObject({ name: "합성과목 가", credit_units: 300, category_ids: ["전선"] });
    expect(c.courses.find((x) => x.id === "SYN102")!.credit_units).toBe(50);
    expect(sec("SYN101").meetings.map((m) => [m.day, m.start_minute, m.end_minute, m.room])).toEqual([
      ["Mon", 540, 615, "R 101"],
      ["Wed", 510, 585, "R 101"],
    ]);
    expect(c.instructors.find((i) => i.id === sec("SYN101").instructor_ids[0])!.name).toBe("가교수");
    expect(sec("SYN102").meetings).toHaveLength(2);
    expect(sec("SYN103").issue_codes).toEqual(["PERIOD_TABLE_MISSING_FOR_DAY"]);
    expect(sec("SYN104").issue_codes).toEqual(["TIME_TBD"]);
    // '전공' 그룹을 자동으로 만들지 않는다(전공 유형 ≠ 내 전공 인정 기준). 개설 소속은 로컬 메타데이터로만 기록.
    expect(c.category_groups).toEqual({});
    expect(r.courseOrgs.SYN101).toBe("가상학부 주간");
  });

  it("rejects real binary Excel files instead of guessing", () => {
    const xls = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0]).buffer;
    expect(decodeTableFile(xls)).toHaveProperty("error");
    expect(decodeTableFile(new Uint8Array([0x50, 0x4b, 3, 4]).buffer)).toHaveProperty("error");
  });
});

describe("credit parsing", () => {
  it.each([
    [".5", 50],
    ["0.5", 50],
    ["1.5", 150],
    ["3", 300],
    ["0", 0],
  ])("%s → %d", (t, u) => expect(creditToUnits(t)).toBe(u));
  it.each(["", ".", "1.505", "-1", "a"])("%s → null", (t) => expect(creditToUnits(t)).toBeNull());
});
