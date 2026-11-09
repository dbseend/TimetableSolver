/**
 * 앱 상태. 규칙:
 * - 카탈로그·이수내역(→허용 분반)·조건 변경은 revision을 올리고 확인을 무효화한다.
 * - solve/diagnose 응답은 요청 시점 revision과 현재 revision이 같을 때만 반영한다.
 */
import type { Catalog, Constraint, DiagnosisResponse, DraftConstraint, ParseResponse, SolveResponse } from "../lib/types";
import type { ImportIssue } from "../features/catalog/adapter";
import type { ProfileEntry } from "../features/profile/transcript";
import type { MajorDefinition } from "../features/major/major";
import { type ConstraintMeta, ingestParse, type PendingDraft, placeResolved } from "../features/review/review";
import { describe } from "../features/constraints/model";

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

export interface UnsupportedItem {
  id: string;
  source_text: string;
  message: string;
  reason_code: string;
  /** 사용자가 '이 조건 제외하고 계속'을 골랐는지(조용히 삭제하지 않고 제외 기록을 남긴다) */
  excluded: boolean;
}

export interface NlState {
  status: "idle" | "parsing" | "done" | "error";
  /** 마지막 해석 응답(경고·제공자 모드 표시용) */
  response: ParseResponse | null;
  /** 확인이 필요한 해석 초안(질문 포함). 여러 번 해석해도 누적된다. */
  drafts: PendingDraft[];
  unsupported: UnsupportedItem[];
  notes: string[];
  lastSummary: { added: number; pending: number; unsupported: number } | null;
  parseNo: number;
  error: string | null;
  forRevision: number | null;
}

export type Phase = "idle" | "solving" | "done" | "error";

export interface State {
  loaded: LoadedCatalog | null;
  profile: ProfileEntry[];
  profileDropped: string[];
  constraints: Constraint[];
  /** 조건 출처(문장·직접 입력·기본 제안값). 화면 표시용 */
  meta: Record<string, ConstraintMeta>;
  nextConstraintNo: number;
  revision: number;
  confirmedRevision: number | null;
  /** stale: 결과를 만든 뒤 데이터·조건이 바뀌어 다시 생성해야 함(이전 결과는 최신처럼 보여 주지 않는다) */
  solve: { phase: Phase; response: SolveResponse | null; error: string | null; selected: number; stale: boolean };
  diagnosis: { phase: Phase; response: DiagnosisResponse | null; error: string | null };
  nl: NlState;
  /** 다른 강좌 데이터로 바꿀 때 유효하지 않아 제외한 조건 등 안내 */
  notices: string[];
}

export const DEFAULT_CREDIT: Constraint = {
  id: "c1",
  type: "credit_range",
  strength: "hard",
  weight: null,
  params: { min_units: 1500, max_units: 1800 },
};

export const emptyNl: NlState = { status: "idle", response: null, drafts: [], unsupported: [], notes: [], lastSummary: null, parseNo: 0, error: null, forRevision: null };
const DEFAULT_META: Record<string, ConstraintMeta> = { c1: { origin: "default", suggested: true } };

export const initialState: State = {
  loaded: null,
  profile: [],
  profileDropped: [],
  // 15~18학점은 초기 '제안'이다. 사용자가 조건 확인을 누르기 전에는 실행하지 않는다.
  constraints: [DEFAULT_CREDIT],
  meta: DEFAULT_META,
  nextConstraintNo: 2,
  revision: 1,
  confirmedRevision: null,
  solve: { phase: "idle", response: null, error: null, selected: 0, stale: false },
  diagnosis: { phase: "idle", response: null, error: null },
  nl: emptyNl,
  notices: [],
};

export type Action =
  | { type: "catalog_loaded"; loaded: LoadedCatalog }
  | { type: "catalog_replaced"; loaded: LoadedCatalog; removeConstraintIds: string[] }
  | { type: "profile_set"; entries: ProfileEntry[]; dropped: string[] }
  | { type: "profile_update"; local_id: string; patch: Partial<ProfileEntry> }
  | { type: "constraint_add"; constraint: Omit<Constraint, "id">; meta?: ConstraintMeta }
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
  | { type: "nl_drafts"; drafts: PendingDraft[] }
  | { type: "nl_ack"; index: number }
  /** 확인할 초안을 해결된 값으로 반영(삭제 요청이면 대상 삭제). 기존 hard 학점 범위와 겹치면 충돌 항목으로 남긴다. */
  | { type: "review_apply"; draftId: string; draft: DraftConstraint }
  | { type: "review_discard"; draftId: string }
  /** 기존 학점 조건과 새 요청 충돌: 기존 유지 / 새 조건(또는 직접 고친 값)으로 변경 */
  | { type: "conflict_resolve"; draftId: string; mode: "keep" | "replace"; params?: Record<string, unknown> }
  | { type: "nl_clear" }
  | { type: "reset_all" }
  /** 처음부터 다시 시작: 강좌 데이터 선택·조건·결과를 모두 지운다(사용자 확인 후) */
  | { type: "restart" }
  | { type: "notices_clear" };

function bump(s: State, patch: Partial<State>): State {
  return {
    ...s,
    ...patch,
    revision: s.revision + 1,
    confirmedRevision: null,
    solve: { phase: "idle", response: null, error: null, selected: 0, stale: !!s.solve.response || s.solve.stale },
    diagnosis: { phase: "idle", response: null, error: null },
  };
}

/** 새 카탈로그에서 조건(또는 초안)의 참조가 유효한지. 학점·요일·시간·등교일은 카탈로그와 무관하게 유효. */
function validIn(catalog: Catalog, c: { type: string; params: Record<string, unknown> }): boolean {
  const p = c.params as Record<string, unknown>;
  const courses = new Set(catalog.courses.map((x) => x.id));
  const sections = new Map(catalog.sections.map((x) => [x.id, x.course_id]));
  const cats = new Set([...catalog.courses.flatMap((x) => x.category_ids), ...catalog.sections.flatMap((x) => x.category_ids ?? []), ...Object.values(catalog.category_groups).flat()]);
  const insts = new Set(catalog.instructors.map((x) => x.id));
  if ((c.type === "must_include" || c.type === "must_exclude") && p.course_id != null && !courses.has(p.course_id as string)) return false;
  if (c.type === "must_include" && Array.isArray(p.allowed_section_ids) && !(p.allowed_section_ids as string[]).every((sid) => sections.get(sid) === p.course_id)) return false;
  if (c.type === "category_min" && Array.isArray(p.category_ids) && !(p.category_ids as string[]).every((x) => cats.has(x))) return false;
  if (c.type === "instructor_avoid" && Array.isArray(p.instructor_ids) && !(p.instructor_ids as string[]).every((x) => insts.has(x))) return false;
  return true;
}

export function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "catalog_loaded": {
      // 같은 카탈로그를 다시 고르면 아무것도 바꾸지 않는다(조건·결과 유지)
      if (s.loaded && s.loaded.revision === a.loaded.revision) return { ...s, notices: [] };
      // 다른 데이터: 조건마다 참조(과목·분반·분류·교수)가 새 데이터에 있는지 다시 검사하고, 빠진 것은 알린다
      const cat = a.loaded.catalog;
      const oldCat = s.loaded?.catalog ?? null;
      const keep = s.constraints.filter((c) => validIn(cat, c));
      const removed = s.constraints.filter((c) => !validIn(cat, c));
      const constraints = keep.some((c) => c.type === "credit_range" && c.strength === "hard") ? keep : [DEFAULT_CREDIT, ...keep.filter((c) => c.id !== "c1")];
      const meta = Object.fromEntries(constraints.map((c) => [c.id, s.meta[c.id] ?? DEFAULT_META.c1]));
      const drafts = s.nl.drafts.filter((d) => validIn(cat, d));
      const notices = [
        ...removed.map((c) => `새 강좌 데이터에 없는 대상을 가리켜 제외한 조건: ${describe(c, oldCat)}`),
        ...(s.nl.drafts.length > drafts.length ? [`이전 데이터 기준이라 확인할 조건 ${s.nl.drafts.length - drafts.length}개를 제외했어요. 필요하면 다시 입력해 주세요.`] : []),
      ];
      return bump(s, { loaded: a.loaded, constraints, meta, nl: { ...s.nl, drafts }, notices });
    }
    case "catalog_replaced":
      // 같은 카탈로그에 분류만 더하거나 뺀 경우(내 전공 설정): 조건은 유지하되 사라진 분류를 참조하는 조건은 지운다.
      return bump(s, { loaded: a.loaded, constraints: s.constraints.filter((c) => !a.removeConstraintIds.includes(c.id)) });
    case "profile_set":
      return bump(s, { profile: a.entries, profileDropped: a.dropped });
    case "profile_update":
      return bump(s, { profile: s.profile.map((e) => (e.local_id === a.local_id ? { ...e, ...a.patch } : e)) });
    case "constraint_add": {
      const id = `c${s.nextConstraintNo}`;
      return bump(s, {
        constraints: [...s.constraints, { ...a.constraint, id } as Constraint],
        meta: { ...s.meta, [id]: a.meta ?? { origin: "manual" } },
        nextConstraintNo: s.nextConstraintNo + 1,
      });
    }
    case "constraint_remove":
      return bump(s, { constraints: s.constraints.filter((c) => c.id !== a.id) });
    case "constraint_replace":
      return bump(s, {
        constraints: s.constraints.map((c) => (c.id === a.constraint.id ? a.constraint : c)),
        meta: { ...s.meta, [a.constraint.id]: { ...(s.meta[a.constraint.id] ?? { origin: "manual" }), suggested: false } },
      });
    case "review_apply": {
      const rest = s.nl.drafts.filter((d) => d.draft_id !== a.draftId);
      const orig = s.nl.drafts.find((d) => d.draft_id === a.draftId);
      if (!orig) return s;
      if (a.draft.action === "delete") {
        return bump(s, { constraints: s.constraints.filter((c) => c.id !== a.draft.target_constraint_id), nl: { ...s.nl, drafts: rest } });
      }
      const placed = placeResolved(s.constraints, a.draft, `c${s.nextConstraintNo}`);
      if (placed.kind === "duplicate") return { ...s, nl: { ...s.nl, drafts: rest, notes: [...s.nl.notes, `“${a.draft.source_text}”은(는) 이미 있는 조건과 같아요.`] } };
      if (placed.kind === "conflict")
        return { ...s, nl: { ...s.nl, drafts: s.nl.drafts.map((d) => (d.draft_id === a.draftId ? { ...a.draft, questions: orig.questions, conflictWith: placed.with } : d)) } };
      return bump(s, {
        constraints: [...s.constraints, placed.constraint],
        meta: { ...s.meta, [placed.constraint.id]: { origin: "nl", source_text: a.draft.source_text } },
        nextConstraintNo: s.nextConstraintNo + 1,
        nl: { ...s.nl, drafts: rest },
      });
    }
    case "review_discard":
      return { ...s, nl: { ...s.nl, drafts: s.nl.drafts.filter((d) => d.draft_id !== a.draftId) } };
    case "conflict_resolve": {
      const d = s.nl.drafts.find((x) => x.draft_id === a.draftId);
      const rest = s.nl.drafts.filter((x) => x.draft_id !== a.draftId);
      if (!d) return s;
      if (a.mode === "keep" || !d.conflictWith) return { ...s, nl: { ...s.nl, drafts: rest } };
      const target = d.conflictWith;
      return bump(s, {
        constraints: s.constraints.map((c) =>
          c.id === target ? ({ ...c, strength: d.strength ?? c.strength, weight: d.strength === "soft" ? (d.weight ?? 5) : null, params: a.params ?? d.params } as Constraint) : c,
        ),
        meta: { ...s.meta, [target]: { origin: "nl", source_text: d.source_text, suggested: false } },
        nl: { ...s.nl, drafts: rest },
      });
    }
    case "confirm":
      return { ...s, confirmedRevision: s.revision };
    case "apply_proposal": {
      // 사용자가 수정안 변경 내용을 보고 '확인하고 적용'을 누른 경우에만 호출된다.
      const next = bump(s, { constraints: a.constraints });
      return { ...next, confirmedRevision: next.revision };
    }
    case "solve_start":
      return { ...s, solve: { phase: "solving", response: null, error: null, selected: 0, stale: false }, diagnosis: { phase: "idle", response: null, error: null } };
    case "solve_done":
      if (a.forRevision !== s.revision) return s; // 오래된 응답 무시
      return { ...s, solve: { phase: "done", response: a.response, error: null, selected: 0, stale: false } };
    case "solve_error":
      if (a.forRevision !== s.revision) return s;
      return { ...s, solve: { phase: "error", response: null, error: a.error, selected: 0, stale: false } };
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
      // 이전 해석에서 남은 확인할 조건·제외 기록은 유지한다(조용히 버리지 않음)
      return { ...s, nl: { ...s.nl, status: "parsing", error: null } };
    case "nl_done": {
      const no = s.nl.parseNo + 1;
      // 응답마다 draft_id가 d1부터 다시 시작하므로 해석 번호를 붙여 구분하고, 각 초안에 자기 질문을 붙여 둔다
      const response: ParseResponse = {
        ...a.response,
        draft_constraints: a.response.draft_constraints.map((d) => ({ ...d, draft_id: `p${no}-${d.draft_id}` })),
        questions: a.response.questions.map((q) => ({ ...q, draft_id: q.draft_id ? `p${no}-${q.draft_id}` : q.draft_id })),
      };
      const r = ingestParse(s.constraints, s.meta, s.nextConstraintNo, response);
      const pending = r.pending.map((d) => ({ ...d, questions: response.questions.filter((q) => q.draft_id === d.draft_id) }));
      const unsupported = response.unsupported_requests.map((u, i) => ({ id: `p${no}-u${i}`, ...u, excluded: false }));
      const nl: NlState = {
        status: "done",
        response: a.response,
        drafts: [...s.nl.drafts, ...pending],
        unsupported: [...s.nl.unsupported, ...unsupported],
        notes: r.notes,
        lastSummary: { added: r.added, pending: pending.length, unsupported: unsupported.length },
        parseNo: no,
        error: null,
        forRevision: a.forRevision,
      };
      return r.added ? bump(s, { constraints: r.constraints, meta: r.meta, nextConstraintNo: r.nextNo, nl }) : { ...s, nl };
    }
    case "nl_error":
      return { ...s, nl: { ...s.nl, status: "error", error: a.error } };
    case "nl_drafts":
      return { ...s, nl: { ...s.nl, drafts: a.drafts } };
    case "nl_ack":
      return { ...s, nl: { ...s.nl, unsupported: s.nl.unsupported.map((u, i) => (i === a.index ? { ...u, excluded: true } : u)) } };
    case "nl_clear":
      return { ...s, nl: emptyNl };
    case "reset_all":
      return { ...initialState, loaded: s.loaded, revision: s.revision + 1 };
    case "restart":
      return { ...initialState, revision: s.revision + 1 };
    case "notices_clear":
      return { ...s, notices: [] };
  }
}

/** 생성을 막는 미처리 자연어 항목 수(확인할 초안 + 제외를 고르지 않은 미지원 요구) */
export function pendingNlCount(nl: NlState): number {
  return nl.drafts.length + nl.unsupported.filter((u) => !u.excluded).length;
}
