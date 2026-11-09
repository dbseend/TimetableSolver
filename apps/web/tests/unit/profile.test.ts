import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDelimited } from "../../src/features/catalog/csv";
import { DEMO_ADAPTER, importCatalog } from "../../src/features/catalog/adapter";
import { computeEligibility } from "../../src/features/profile/eligibility";
import { gradeToStatus, parseTranscript } from "../../src/features/profile/transcript";

const root = new URL("../../../../fixtures/", import.meta.url);
const catalog = importCatalog(parseDelimited(readFileSync(new URL("catalogs/demo-campus-2026-2.csv", root), "utf-8")), DEMO_ADAPTER).catalog!;
const transcript = readFileSync(new URL("profile/demo-transcript.tsv", root), "utf-8");

describe("transcript local processing", () => {
  const r = parseTranscript(transcript, catalog);

  it("drops student id, name and grade columns and never stores them", () => {
    expect(r.droppedColumns).toEqual(expect.arrayContaining(["학번", "이름", "성적"]));
    const serialized = JSON.stringify(r.entries);
    expect(serialized).not.toContain("20269999");
    expect(serialized).not.toContain("홍길동");
    expect(serialized).not.toMatch(/"A0"|"A\+"|"B\+"|"F"/);
  });
  it("derives completion/recognition from grade", () => {
    const by = (code: string) => r.entries.find((e) => e.course_code === code)!;
    expect(by("CSE201")).toMatchObject({ completion_status: "completed", recognized: true, match_status: "matched" });
    expect(by("CSE202")).toMatchObject({ completion_status: "not_completed", recognized: false });
    expect(by("CSE110")).toMatchObject({ match_status: "historical_only" }); // 과거 과목도 삭제하지 않음
  });
  it("in-progress is not completed", () => {
    expect(gradeToStatus("", "2026-2", "2026-2")).toEqual({ completion: "in_progress", recognized: null });
    expect(gradeToStatus("", "2025-1", "2026-2").completion).toBe("unknown");
  });
});

describe("eligibility", () => {
  const entries = parseTranscript(transcript, catalog).entries;

  it("excludes completed+recognized courses and unsupported sections; keeps failed courses", () => {
    const e = computeEligibility(catalog, entries);
    expect(e.allowed.some((id) => id.includes(":CSE201:"))).toBe(false);
    expect(e.allowed.some((id) => id.includes(":GEN101:"))).toBe(false);
    expect(e.allowed.some((id) => id.includes(":CSE202:"))).toBe(true); // F → 재수강 가능
    expect(e.allowed).not.toContain("2026-2:CSE210:02");
    expect(e.excluded.find((x) => x.section_id === "2026-2:CSE201:01")!.reason).toContain("이미 이수");
  });
  it("allow_retake re-includes the course", () => {
    const e = computeEligibility(catalog, entries.map((x) => (x.course_code === "CSE201" ? { ...x, allow_retake: true } : x)));
    expect(e.allowed).toContain("2026-2:CSE201:01");
  });
  it("needs_review (name-only) match does not exclude until confirmed", () => {
    const t = "과목명\t성적\n자료구조\tA0";
    const r = parseTranscript(t, catalog);
    expect(r.entries[0].match_status).toBe("needs_review");
    expect(computeEligibility(catalog, r.entries).allowed).toContain("2026-2:CSE201:01");
    expect(computeEligibility(catalog, [{ ...r.entries[0], match_status: "matched" }]).allowed).not.toContain("2026-2:CSE201:01");
  });
  it("returns an empty array (not 'all') when nothing is allowed", () => {
    const all = catalog.courses.map((c, i) => ({
      local_id: `x${i}`, course_code: c.id, course_name: c.name, credit_units: c.credit_units, term_id: "2025-1",
      completion_status: "completed" as const, recognized: true, allow_retake: false, match_status: "matched" as const, matched_course_id: c.id,
    }));
    expect(computeEligibility(catalog, all).allowed).toEqual([]);
  });
});
