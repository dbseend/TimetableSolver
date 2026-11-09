/**
 * 앱 상태. 규칙:
 * - 카탈로그·이수내역(→허용 분반)·조건 변경은 revision을 올리고 확인을 무효화한다.
 * - solve/diagnose 응답은 요청 시점 revision과 현재 revision이 같을 때만 반영한다.
 */
import type { Catalog, Constraint, DiagnosisResponse, DraftConstraint, ParseResponse, SolveResponse } from "../lib/types";
import type { ImportIssue } from "../features/catalog/adapter";
import type { ProfileEntry } from "../features/profile/transcript";
import type { MajorDefinition } from "../features/major/major";

export interface LoadedCatalog {
  catalog: Catalog;
  revision: string;
  source: "demo" | "upload" | "school";
  fileName: string;
  /** 기본 학교 데이터의 기준일(YYYY-MM-DD). 모르면 null. 샘플·업로드는 undefined. */
  asOf?: string | null;
  issues: ImportIssue[];
  serverWarnings: string[];
  /** 과목 → 개설 소속(로컬 메타데이터, 서버 미전송). */
  courseOrgs: Record<string, string>;
  /** 사용자가 '전공 유형'으로 표시한 이수구분 category id(예: 전필·전선). 내 전공 인정 기준과 별개. */
  majorTypeCategories: string[];
  /** 사용자가 확인한 내 전공 과목 기준. 없으면 내 전공 최소 학점 조건을 막는다. */
  major: MajorDefinition | null;
}

export interface NlState {
  status: "idle" | "parsing" | "done" | "error";
  response: ParseResponse | null;
  drafts: DraftConstraint[];
  acknowledgedUnsupported: number[];
  error: string | null;
  forRevision: number | null;
}

export type Phase = "idle" | "solving" | "done" | "error";

export interface State {
  loaded: LoadedCatalog | null;
  profile: ProfileEntry[];
  profileDropped: string[];
  constraints: Constraint[];
  nextConstraintNo: number;
  revision: number;
  confirmedRevision: number | null;
  solve: { phase: Phase; response: SolveResponse | null; error: string | null; selected: number };
  diagnosis: { phase: Phase; response: DiagnosisResponse | null; error: string | null };
  nl: NlState;
}

export const DEFAULT_CREDIT: Constraint = {
  id: "c1",
  type: "credit_range",
  strength: "hard",
  weight: null,
  params: { min_units: 1500, max_units: 1800 },
};

export const emptyNl: NlState = { status: "idle", response: null, drafts: [], acknowledgedUnsupported: [], error: null, forRevision: null };

export const initialState: State = {
  loaded: null,
  profile: [],
  profileDropped: [],
  // 15~18학점은 초기 '제안'이다. 사용자가 조건 확인을 누르기 전에는 실행하지 않는다.
  constraints: [DEFAULT_CREDIT],
  nextConstraintNo: 2,
  revision: 1,
  confirmedRevision: null,
  solve: { phase: "idle", response: null, error: null, selected: 0 },
  diagnosis: { phase: "idle", response: null, error: null },
  nl: emptyNl,
};

export type Action =
  | { type: "catalog_loaded"; loaded: LoadedCatalog }
  | { type: "catalog_replaced"; loaded: LoadedCatalog; removeConstraintIds: string[] }
  | { type: "profile_set"; entries: ProfileEntry[]; dropped: string[] }
  | { type: "profile_update"; local_id: string; patch: Partial<ProfileEntry> }
  | { type: "constraint_add"; constraint: Omit<Constraint, "id"> }
  | { type: "constraint_remove"; id: string }
  | { type: "constraint_replace"; constraint: Constraint }
  | { type: "confirm" }
  | { type: "apply_proposal"; constraints: Constraint[] }
  | { type: "solve_start" }
  | { type: "solve_done"; forRevision: number; response: SolveResponse }
  | { type: "solve_error"; forRevision: number; error: string }
  | { type: "select_candidate"; index: number }
  | { type: "diagnose_start" }
  | { type: "diagnose_done"; forRevision: number; response: DiagnosisResponse }
  | { type: "diagnose_error"; forRevision: number; error: string }
  | { type: "nl_start" }
  | { type: "nl_done"; forRevision: number; response: ParseResponse }
  | { type: "nl_error"; error: string }
  | { type: "nl_drafts"; drafts: DraftConstraint[] }
  | { type: "nl_ack"; index: number }
  | { type: "nl_clear" }
  | { type: "reset_all" };

function bump(s: State, patch: Partial<State>): State {
  return {
    ...s,
    ...patch,
    revision: s.revision + 1,
    confirmedRevision: null,
    solve: { phase: "idle", response: null, error: null, selected: 0 },
    diagnosis: { phase: "idle", response: null, error: null },
  };
}

export function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "catalog_loaded": {
      // 새 카탈로그에서는 과목·교수·분류 참조 조건이 무효일 수 있으므로 학점 범위만 남긴다(명시적 안내).
      const kept = s.constraints.filter((c) => c.type === "credit_range");
      return bump(s, { loaded: a.loaded, constraints: kept.length ? kept : [DEFAULT_CREDIT], nl: emptyNl });
    }
    case "catalog_replaced":
      // 같은 카탈로그에 분류만 더하거나 뺀 경우(내 전공 설정): 조건은 유지하되 사라진 분류를 참조하는 조건은 지운다.
      return bump(s, { loaded: a.loaded, constraints: s.constraints.filter((c) => !a.removeConstraintIds.includes(c.id)) });
    case "profile_set":
      return bump(s, { profile: a.entries, profileDropped: a.dropped });
    case "profile_update":
      return bump(s, { profile: s.profile.map((e) => (e.local_id === a.local_id ? { ...e, ...a.patch } : e)) });
    case "constraint_add":
      return bump(s, {
        constraints: [...s.constraints, { ...a.constraint, id: `c${s.nextConstraintNo}` } as Constraint],
        nextConstraintNo: s.nextConstraintNo + 1,
      });
    case "constraint_remove":
      return bump(s, { constraints: s.constraints.filter((c) => c.id !== a.id) });
    case "constraint_replace":
      return bump(s, { constraints: s.constraints.map((c) => (c.id === a.constraint.id ? a.constraint : c)) });
    case "confirm":
      return { ...s, confirmedRevision: s.revision };
    case "apply_proposal": {
      // 사용자가 수정안 변경 내용을 보고 '확인하고 적용'을 누른 경우에만 호출된다.
      const next = bump(s, { constraints: a.constraints });
      return { ...next, confirmedRevision: next.revision };
    }
    case "solve_start":
      return { ...s, solve: { phase: "solving", response: null, error: null, selected: 0 }, diagnosis: { phase: "idle", response: null, error: null } };
    case "solve_done":
      if (a.forRevision !== s.revision) return s; // 오래된 응답 무시
      return { ...s, solve: { phase: "done", response: a.response, error: null, selected: 0 } };
    case "solve_error":
      if (a.forRevision !== s.revision) return s;
      return { ...s, solve: { phase: "error", response: null, error: a.error, selected: 0 } };
    case "select_candidate":
      return { ...s, solve: { ...s.solve, selected: a.index } };
    case "diagnose_start":
      return { ...s, diagnosis: { phase: "solving", response: null, error: null } };
    case "diagnose_done":
      if (a.forRevision !== s.revision) return s;
      return { ...s, diagnosis: { phase: "done", response: a.response, error: null } };
    case "diagnose_error":
      if (a.forRevision !== s.revision) return s;
      return { ...s, diagnosis: { phase: "error", response: null, error: a.error } };
    case "nl_start":
      return { ...s, nl: { ...emptyNl, status: "parsing" } };
    case "nl_done":
      return { ...s, nl: { status: "done", response: a.response, drafts: a.response.draft_constraints, acknowledgedUnsupported: [], error: null, forRevision: a.forRevision } };
    case "nl_error":
      return { ...s, nl: { ...emptyNl, status: "error", error: a.error } };
    case "nl_drafts":
      return { ...s, nl: { ...s.nl, drafts: a.drafts } };
    case "nl_ack":
      return { ...s, nl: { ...s.nl, acknowledgedUnsupported: [...s.nl.acknowledgedUnsupported, a.index] } };
    case "nl_clear":
      return { ...s, nl: emptyNl };
    case "reset_all":
      return { ...initialState, loaded: s.loaded, revision: s.revision + 1 };
  }
}

/** 확인 버튼을 막는 미처리 자연어 항목 수 */
export function pendingNlCount(nl: NlState): number {
  const unsupported = nl.response?.unsupported_requests.length ?? 0;
  return nl.drafts.length + (unsupported - nl.acknowledgedUnsupported.length);
}
