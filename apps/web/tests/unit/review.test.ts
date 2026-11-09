import { describe, expect, it } from "vitest";
import type { Constraint, DraftConstraint, ParseResponse } from "../../src/lib/types";
import { initialState, pendingNlCount, reducer, type State } from "../../src/app/state";
import { reviewItems } from "../../src/features/review/review";

const d = (p: Partial<DraftConstraint>): DraftConstraint => ({
  draft_id: "d1",
  type: "day_off",
  strength: "soft",
  weight: 5,
  params: { days: ["Fri"] },
  source_text: "금요일은 가능하면 비워",
  unresolved_fields: [],
  action: "add",
  target_constraint_id: null,
  ...p,
});
const resp = (drafts: DraftConstraint[], extra: Partial<ParseResponse> = {}): ParseResponse =>
  ({ schema_version: "1.0", request_id: "r", catalog_revision: "x", input_revision: 1, status: "parsed", draft_constraints: drafts, questions: [], unsupported_requests: [], warnings: [], provider_mode: "fixture", ...extra }) as ParseResponse;
const items = (s: State) => reviewItems({ constraints: s.constraints, pending: s.nl.drafts, unsupported: s.nl.unsupported, majorTypeCategories: [], major: null });
const parse = (s: State, r: ParseResponse) => reducer(reducer(s, { type: "nl_start" }), { type: "nl_done", forRevision: s.revision, response: r });

describe("해석 결과 반영과 확인할 조건", () => {
  it("완전한 해석은 바로 '반영 완료' 조건이 되고 확인할 조건이 없다 (출처 기록, revision 증가)", () => {
    const s = parse(initialState, resp([d({})]));
    expect(s.constraints.map((c) => c.type)).toEqual(["credit_range", "day_off"]);
    expect(s.meta[s.constraints[1].id]).toEqual({ origin: "nl", source_text: "금요일은 가능하면 비워" });
    expect(items(s)).toEqual([]);
    expect(s.revision).toBe(initialState.revision + 1);
    expect(s.nl.lastSummary).toEqual({ added: 1, pending: 0, unsupported: 0 });
  });

  it("빈 값이 있는 초안은 조건 목록에 들어가지 않고 확인할 조건이 된다", () => {
    const s = parse(initialState, resp([d({ type: "time_avoid", params: { days: null, start_minute: 1080, end_minute: 1440 }, unresolved_fields: ["params.days"] })]));
    expect(s.constraints).toHaveLength(1);
    expect(items(s).map((i) => i.kind)).toEqual(["draft"]);
    const id = s.nl.drafts[0].draft_id;
    const s2 = reducer(s, { type: "review_apply", draftId: id, draft: { ...s.nl.drafts[0], params: { days: ["Mon"], start_minute: 1080, end_minute: 1440 }, unresolved_fields: [] } });
    expect(items(s2)).toEqual([]);
    expect(s2.constraints.at(-1)).toMatchObject({ type: "time_avoid", params: { days: ["Mon"] } });
  });

  it("새 학점 범위가 기존 hard 학점 범위와 다르면 덮어쓰지 않고 충돌 항목으로 둔다", () => {
    const s = parse(initialState, resp([d({ type: "credit_range", strength: "hard", weight: null, params: { min_units: 1200, max_units: 1500 }, source_text: "12~15학점" })]));
    expect(s.constraints).toEqual(initialState.constraints); // 기존 유지
    const [it0] = items(s);
    expect(it0.kind).toBe("conflict");
    const keep = reducer(s, { type: "conflict_resolve", draftId: s.nl.drafts[0].draft_id, mode: "keep" });
    expect(keep.constraints).toEqual(initialState.constraints);
    expect(items(keep)).toEqual([]);
    const repl = reducer(s, { type: "conflict_resolve", draftId: s.nl.drafts[0].draft_id, mode: "replace" });
    expect(repl.constraints).toHaveLength(1);
    expect(repl.constraints[0]).toMatchObject({ id: "c1", params: { min_units: 1200, max_units: 1500 } });
    const edited = reducer(s, { type: "conflict_resolve", draftId: s.nl.drafts[0].draft_id, mode: "replace", params: { min_units: 1300, max_units: 1600 } });
    expect(edited.constraints[0].params).toEqual({ min_units: 1300, max_units: 1600 });
    expect(edited.meta.c1.suggested).toBe(false);
  });

  it("같은 조건이면 중복 추가하지 않고 알려 준다", () => {
    const s = parse(initialState, resp([d({ type: "credit_range", strength: "hard", weight: null, params: { min_units: 1500, max_units: 1800 }, source_text: "15~18학점" })]));
    expect(s.constraints).toHaveLength(1);
    expect(items(s)).toEqual([]);
    expect(s.nl.notes[0]).toContain("이미 있는 조건과 같아서");
  });

  it("미지원 요구는 제외를 고르기 전까지 확인할 조건이고, 제외해도 기록이 남는다", () => {
    const s = parse(initialState, resp([], { unsupported_requests: [{ source_text: "점심시간 비워줘", reason_code: "P1_NOT_IMPLEMENTED", message: "점심시간 확보는 지원하지 않습니다." }] }));
    expect(items(s).map((i) => i.kind)).toEqual(["unsupported"]);
    expect(pendingNlCount(s.nl)).toBe(1);
    const s2 = reducer(s, { type: "nl_ack", index: 0 });
    expect(items(s2)).toEqual([]);
    expect(s2.nl.unsupported[0]).toMatchObject({ excluded: true, source_text: "점심시간 비워줘" });
  });

  it("두 번 해석해도 앞선 확인할 조건을 잃지 않고 draft_id가 겹치지 않는다", () => {
    const pendingDraft = d({ type: "time_avoid", params: { days: null, start_minute: 1080, end_minute: 1440 }, unresolved_fields: ["params.days"] });
    const s = parse(parse(initialState, resp([pendingDraft])), resp([pendingDraft]));
    expect(s.nl.drafts.map((x) => x.draft_id)).toEqual(["p1-d1", "p2-d1"]);
    expect(items(s)).toHaveLength(2);
  });

  it("학점 범위가 없으면 학점 확인 항목, 두 개면 하나만 남기라는 항목", () => {
    const none = reducer(initialState, { type: "constraint_remove", id: "c1" });
    expect(items(none).map((i) => i.kind)).toEqual(["credit"]);
    const two = reducer(initialState, { type: "constraint_add", constraint: { type: "credit_range", strength: "hard", weight: null, params: { min_units: 900, max_units: 1200 } } as Omit<Constraint, "id"> });
    const [ci] = items(two);
    expect(ci.kind === "credit" && ci.problem).toBe("multiple");
  });

  it("조건 변경은 이전 결과와 확인을 무효화한다(늦은 응답은 무시)", () => {
    let s = reducer(initialState, { type: "confirm" });
    s = reducer(s, { type: "solve_start" });
    const before = s.revision;
    s = parse(s, resp([d({})]));
    expect(s.confirmedRevision).toBeNull();
    expect(reducer(s, { type: "solve_done", forRevision: before, response: { input_revision: before } as never }).solve.response).toBeNull();
  });
});
