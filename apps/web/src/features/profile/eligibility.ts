/**
 * 수강 가능 분반(allowed_section_ids) 로컬 계산. 서버에는 결과 ID 목록만 보낸다(제외 이유는 로컬에만).
 * 빈 배열은 "허용 분반 0개"다. 전체 허용으로 해석하지 않는다.
 * 학교가 발급한 수강 자격 판정이 아니다. 선수과목 규칙은 학교 자료가 없어 판정하지 않는다(P0).
 */
import type { Catalog } from "../../lib/types";
import type { ProfileEntry } from "./transcript";

export interface Eligibility {
  allowed: string[];
  excluded: { section_id: string; reason: string }[];
}

export function excludesCourse(e: ProfileEntry): boolean {
  return e.match_status === "matched" && e.completion_status === "completed" && e.recognized === true && !e.allow_retake;
}

export function computeEligibility(catalog: Catalog, entries: ProfileEntry[]): Eligibility {
  const done = new Map<string, ProfileEntry>();
  for (const e of entries) if (e.matched_course_id && excludesCourse(e)) done.set(e.matched_course_id, e);
  const allowed: string[] = [];
  const excluded: Eligibility["excluded"] = [];
  for (const s of catalog.sections) {
    if (s.support_status !== "supported") {
      excluded.push({ section_id: s.id, reason: `지원하지 않는 시간 정보(${s.issue_codes.join(", ")})` });
      continue;
    }
    const e = done.get(s.course_id);
    if (e) {
      excluded.push({ section_id: s.id, reason: `이미 이수·인정된 과목(${e.term_id ?? "학기 미상"})` });
      continue;
    }
    allowed.push(s.id);
  }
  return { allowed, excluded };
}
