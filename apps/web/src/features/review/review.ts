/**
 * '확인할 조건' 계산(순수 함수).
 * - 완전히 해석된 조건은 바로 조건 목록(반영 완료)에 넣는다. 최종 확정은 '이 조건으로 시간표 만들기' 클릭(요약을 보고 누름)이다.
 * - 값이 비었거나 모호한 조건, 기존 학점 범위와 충돌하는 새 요청, 기존 조건 삭제 요청, 지원하지 않는 요구,
 *   학점 범위 누락·내 전공 미확인은 '확인할 조건'으로 모은다. 하나라도 남으면 /solve를 부르지 않는다.
 * - 사용자가 이미 둔 조건을 조용히 덮어쓰지 않는다(충돌은 사용자가 고른다).
 */
import type { Constraint, DraftConstraint, ParseResponse, Question } from "../../lib/types";
import { draftToConstraint, hardCreditRangeProblem, isResolved } from "../constraints/model";
import { majorConstraintProblem, type MajorDefinition } from "../major/major";

export type Origin = "manual" | "nl" | "default" | "proposal";
export interface ConstraintMeta {
  origin: Origin;
  source_text?: string;
  /** 사용자가 말하지 않은 제안값(예: 기본 15~18학점). 수정하면 false. */
  suggested?: boolean;
}
export type PendingDraft = DraftConstraint & { conflictWith?: string; questions?: Question[] };

const sameParams = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export const isHardCredit = (c: { type: string; strength: string | null }) => c.type === "credit_range" && c.strength === "hard";

export function sameConstraint(a: Omit<Constraint, "id">, b: Omit<Constraint, "id">): boolean {
  return a.type === b.type && a.strength === b.strength && (a.weight ?? null) === (b.weight ?? null) && sameParams(a.params, b.params);
}

/** 해석 응답 → 바로 반영할 조건 + 확인할 초안. */
export function ingestParse(
  constraints: Constraint[],
  meta: Record<string, ConstraintMeta>,
  nextNo: number,
  response: ParseResponse,
): { constraints: Constraint[]; meta: Record<string, ConstraintMeta>; nextNo: number; pending: PendingDraft[]; notes: string[]; added: number } {
  let cs = [...constraints];
  const m = { ...meta };
  let no = nextNo;
  const pending: PendingDraft[] = [];
  const notes: string[] = [];
  let added = 0;
  for (const d of response.draft_constraints) {
    if (d.action === "delete" || !isResolved(d)) {
      pending.push(d);
      continue;
    }
    const placed = placeResolved(cs, d, `c${no}`);
    if (placed.kind === "duplicate") {
      notes.push(`“${d.source_text}”은(는) 이미 있는 조건과 같아서 따로 추가하지 않았어요.`);
      continue;
    }
    if (placed.kind === "conflict") {
      pending.push({ ...d, conflictWith: placed.with });
      continue;
    }
    cs = [...cs, placed.constraint];
    m[placed.constraint.id] = { origin: "nl", source_text: d.source_text };
    no += 1;
    added += 1;
  }
  return { constraints: cs, meta: m, nextNo: no, pending, notes, added };
}

/** 해결된 초안을 목록에 놓을 수 있는지: 그대로 추가 / 이미 같은 조건 / 기존 hard 학점 범위와 충돌. */
export function placeResolved(
  constraints: Constraint[],
  d: DraftConstraint,
  id: string,
): { kind: "add"; constraint: Constraint } | { kind: "duplicate" } | { kind: "conflict"; with: string } {
  const c = draftToConstraint(d, id);
  if (!c) throw new Error("unresolved draft");
  const { id: _i, ...body } = c;
  void _i;
  if (constraints.some((x) => sameConstraint({ ...x, id: undefined } as never, body as never))) return { kind: "duplicate" };
  if (isHardCredit(c)) {
    const existing = constraints.find(isHardCredit);
    if (existing) return { kind: "conflict", with: existing.id };
  }
  return { kind: "add", constraint: c };
}

export type ReviewItem =
  | { key: string; kind: "draft"; draft: PendingDraft }
  | { key: string; kind: "conflict"; draft: PendingDraft; existing: Constraint }
  | { key: string; kind: "delete"; draft: PendingDraft; target: Constraint | null }
  | { key: string; kind: "unsupported"; index: number; source_text: string; message: string; reason_code: string }
  | { key: string; kind: "credit"; problem: "missing" | "multiple" | "nonpositive"; constraints: Constraint[] }
  | { key: string; kind: "major"; message: string; constraintIds: string[] };

export function reviewItems(args: {
  constraints: Constraint[];
  pending: PendingDraft[];
  unsupported: { source_text: string; message: string; reason_code: string; excluded: boolean }[];
  majorTypeCategories: string[];
  major: MajorDefinition | null;
}): ReviewItem[] {
  const { constraints, pending, unsupported } = args;
  const items: ReviewItem[] = [];
  for (const d of pending) {
    if (d.action === "delete") items.push({ key: `del-${d.draft_id}`, kind: "delete", draft: d, target: constraints.find((c) => c.id === d.target_constraint_id) ?? null });
    else if (d.conflictWith && constraints.some((c) => c.id === d.conflictWith))
      items.push({ key: `cf-${d.draft_id}`, kind: "conflict", draft: d, existing: constraints.find((c) => c.id === d.conflictWith)! });
    else items.push({ key: `dr-${d.draft_id}`, kind: "draft", draft: { ...d, conflictWith: undefined } });
  }
  unsupported.forEach((u, i) => {
    if (!u.excluded) items.push({ key: `un-${i}`, kind: "unsupported", index: i, source_text: u.source_text, message: u.message, reason_code: u.reason_code });
  });
  // 학점 범위: 확인할 학점 초안이 남아 있으면 그걸 먼저 해결하게 하고 따로 묻지 않는다
  const creditPending = pending.some((d) => d.type === "credit_range" && d.action !== "delete");
  const problem = hardCreditRangeProblem(constraints);
  if (problem && !creditPending) {
    const hard = constraints.filter(isHardCredit);
    items.push({ key: "credit", kind: "credit", problem: hard.length === 0 ? "missing" : hard.length > 1 ? "multiple" : "nonpositive", constraints: hard });
  }
  const majorMsg = majorConstraintProblem(constraints, args.majorTypeCategories, args.major);
  if (majorMsg) {
    const ids = constraints
      .filter((c) => c.type === "category_min" && (c.params as { category_ids: string[] }).category_ids.some((x) => args.majorTypeCategories.includes(x)))
      .map((c) => c.id);
    items.push({ key: "major", kind: "major", message: majorMsg, constraintIds: ids });
  }
  return items;
}
