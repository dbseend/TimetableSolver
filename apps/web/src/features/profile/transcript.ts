/**
 * 이수내역 로컬 처리. 이 모듈의 입력·출력은 브라우저 밖으로 나가지 않는다(서버·LLM 전송 금지).
 *
 * - 학번·이름·성적 등 불필요 열은 파싱 직후 버린다. 성적은 인정 여부(recognized) 판정에만 쓰고 저장하지 않는다.
 * - 현재 학기 개설과목과 매칭되지 않은 과거 과목도 삭제하지 않고 historical_only로 남긴다.
 */
import type { Catalog } from "../../lib/types";
import { creditToUnits } from "../../lib/time";
import { parseDelimited } from "../catalog/csv";

export type CompletionStatus = "completed" | "in_progress" | "not_completed" | "unknown";
export type MatchStatus = "matched" | "needs_review" | "historical_only";

export interface ProfileEntry {
  local_id: string;
  course_code: string | null;
  course_name: string;
  credit_units: number | null;
  term_id: string | null;
  completion_status: CompletionStatus;
  recognized: boolean | null;
  allow_retake: boolean;
  match_status: MatchStatus;
  /** 매칭(또는 확인 대기) 대상 현재 학기 과목 ID */
  matched_course_id: string | null;
}

export interface TranscriptParse {
  entries: ProfileEntry[];
  droppedColumns: string[];
  keptColumns: string[];
  failedRows: number[];
}

const KEEP = {
  code: ["과목코드", "학수번호", "교과목번호", "course_code", "code"],
  name: ["과목명", "교과목명", "course_name", "name"],
  credit: ["학점", "credit", "credits"],
  term: ["이수학기", "학기", "수강학기", "term", "term_id"],
  grade: ["성적", "등급", "grade"],
};
const n = (s: string) => s.replace(/\s+/g, "").toLowerCase();
const find = (headers: string[], keys: string[]) => headers.findIndex((h) => keys.some((k) => n(k) === n(h)));

const PASS = new Set(["A+", "A0", "A", "A-", "B+", "B0", "B", "B-", "C+", "C0", "C", "C-", "D+", "D0", "D", "D-", "P", "S", "PASS"]);
const FAIL = new Set(["F", "NP", "U", "FAIL"]);
const WITHDRAWN = new Set(["W", "WD", "철회", "수강철회"]);

/** 성적 문자열 → 상태. 성적 원문은 반환·저장하지 않는다. */
export function gradeToStatus(grade: string, termId: string | null, currentTermId: string): { completion: CompletionStatus; recognized: boolean | null } {
  const g = grade.trim().toUpperCase();
  if (!g) return termId && termId === currentTermId ? { completion: "in_progress", recognized: null } : { completion: "unknown", recognized: null };
  if (PASS.has(g)) return { completion: "completed", recognized: true };
  if (FAIL.has(g)) return { completion: "not_completed", recognized: false };
  if (WITHDRAWN.has(g)) return { completion: "not_completed", recognized: false };
  return { completion: "unknown", recognized: null };
}

/** 저장된 항목을 새 카탈로그에 다시 매칭(과목코드 정확 일치만 자동, 이름 일치는 확인 대기). */
export function rematchProfile(entries: ProfileEntry[], catalog: Catalog): ProfileEntry[] {
  const codes = new Set(catalog.courses.map((c) => c.id));
  const byName = new Map<string, string[]>();
  for (const c of catalog.courses) byName.set(n(c.name), [...(byName.get(n(c.name)) ?? []), c.id]);
  return entries.map((e) => {
    if (e.course_code && codes.has(e.course_code)) return { ...e, match_status: "matched", matched_course_id: e.course_code };
    const hits = byName.get(n(e.course_name)) ?? [];
    if (hits.length === 1) return { ...e, match_status: "needs_review", matched_course_id: hits[0] };
    return { ...e, match_status: "historical_only", matched_course_id: null };
  });
}

export function parseTranscript(text: string, catalog: Catalog): TranscriptParse {
  const rows = parseDelimited(text);
  if (rows.length < 2) return { entries: [], droppedColumns: [], keptColumns: [], failedRows: [] };
  const headers = rows[0].map((h) => h.trim());
  const idx = {
    code: find(headers, KEEP.code),
    name: find(headers, KEEP.name),
    credit: find(headers, KEEP.credit),
    term: find(headers, KEEP.term),
    grade: find(headers, KEEP.grade),
  };
  const keptIdx = new Set([idx.code, idx.name, idx.credit, idx.term].filter((i) => i >= 0));
  const keptColumns = headers.filter((_, i) => keptIdx.has(i));
  // 성적은 상태 판정 후 버리므로 '제거됨'으로 보고한다.
  const droppedColumns = headers.filter((_, i) => !keptIdx.has(i));

  const byCode = new Map(catalog.courses.map((c) => [c.id, c]));
  const byName = new Map<string, string[]>();
  for (const c of catalog.courses) byName.set(n(c.name), [...(byName.get(n(c.name)) ?? []), c.id]);

  const entries: ProfileEntry[] = [];
  const failedRows: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const cell = (k: number) => (k >= 0 ? (r[k] ?? "").trim() : "");
    const code = cell(idx.code) || null;
    const name = cell(idx.name);
    if (!code && !name) {
      failedRows.push(i);
      continue;
    }
    const termId = cell(idx.term) || null;
    const { completion, recognized } = gradeToStatus(cell(idx.grade), termId, catalog.term_id);
    let match: MatchStatus = "historical_only";
    let matched: string | null = null;
    if (code && byCode.has(code)) {
      match = "matched";
      matched = code;
    } else if (name && (byName.get(n(name)) ?? []).length === 1) {
      // 이름만 일치: 자동 확정하지 않고 사용자 확인 대기
      match = "needs_review";
      matched = byName.get(n(name))![0];
    }
    entries.push({
      local_id: `p${i}`,
      course_code: code,
      course_name: name || code || "",
      credit_units: creditToUnits(cell(idx.credit)),
      term_id: termId,
      completion_status: completion,
      recognized,
      allow_retake: false,
      match_status: match,
      matched_course_id: matched,
    });
  }
  return { entries, droppedColumns, keptColumns, failedRows };
}
