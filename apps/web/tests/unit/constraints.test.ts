import { describe, expect, it } from "vitest";
import type { DraftConstraint, SolveResponse } from "../../src/lib/types";
import { applyPatch, draftToConstraint, hardCreditRangeProblem, isResolved } from "../../src/features/constraints/model";
import { initialState, pendingNlCount, reducer } from "../../src/app/state";

const draft = (p: Partial<DraftConstraint>): DraftConstraint => ({
  draft_id: "d1", type: "time_avoid", strength: "soft", weight: 5, params: {}, source_text: "x", unresolved_fields: [], action: "add", target_constraint_id: null, ...p,
});

describe("NL draft handling", () => {
  it("applies question patches and resolves fields", () => {
    const d = draft({ params: { days: ["Mon"], start_minute: null, end_minute: null }, unresolved_fields: ["params.start_minute", "params.end_minute"] });
    expect(isResolved(d)).toBe(false);
    expect(draftToConstraint(d, "c9")).toBeNull();
    const r = applyPatch(d, "params.time_window", { "params.start_minute": 0, "params.end_minute": 540 })!;
    expect(r.unresolved_fields).toEqual([]);
    expect(draftToConstraint(r, "c9")).toEqual({ id: "c9", type: "time_avoid", strength: "soft", weight: 5, params: { days: ["Mon"], start_minute: 0, end_minute: 540 } });
  });
  it("'interpretation' question resolved by empty patch, discard option drops the draft", () => {
    const d = draft({ params: { days: ["Mon"], start_minute: 540, end_minute: 600 }, unresolved_fields: ["interpretation"] });
    expect(isResolved(applyPatch(d, "interpretation", {})!)).toBe(true);
    expect(applyPatch(d, "interpretation", { discard: true })).toBeNull();
  });
  it("strength must be chosen; hard has null weight", () => {
    const d = draft({ type: "day_off", strength: null, params: { days: ["Fri"] }, unresolved_fields: ["strength"] });
    const r = applyPatch(d, "strength", { strength: "hard", weight: null })!;
    expect(draftToConstraint(r, "c2")).toMatchObject({ strength: "hard", weight: null });
  });
  it("requires exactly one hard credit range with min > 0", () => {
    expect(hardCreditRangeProblem([])).not.toBeNull();
    expect(hardCreditRangeProblem([{ id: "a", type: "credit_range", strength: "hard", weight: null, params: { min_units: 0, max_units: 300 } }])).not.toBeNull();
    expect(hardCreditRangeProblem([initialState.constraints[0]])).toBeNull();
  });
});

describe("revision / confirmation state", () => {
  it("any constraint change invalidates confirmation", () => {
    let s = reducer(initialState, { type: "confirm" });
    expect(s.confirmedRevision).toBe(s.revision);
    s = reducer(s, { type: "constraint_add", constraint: { type: "day_off", strength: "soft", weight: 5, params: { days: ["Fri"] } } });
    expect(s.confirmedRevision).toBeNull();
    expect(s.revision).toBe(initialState.revision + 1);
  });
  it("ignores stale solve responses", () => {
    const s0 = reducer(reducer(initialState, { type: "confirm" }), { type: "solve_start" });
    const fake = { input_revision: 0 } as SolveResponse;
    expect(reducer(s0, { type: "solve_done", forRevision: s0.revision - 1, response: fake }).solve.phase).toBe("solving");
    expect(reducer(s0, { type: "solve_done", forRevision: s0.revision, response: fake }).solve.phase).toBe("done");
  });
  it("unacknowledged unsupported requests block confirmation", () => {
    const resp = { draft_constraints: [], unsupported_requests: [{ source_text: "점심", reason_code: "P1", message: "" }] } as never;
    let s = reducer(initialState, { type: "nl_done", forRevision: 1, response: resp });
    expect(pendingNlCount(s.nl)).toBe(1);
    s = reducer(s, { type: "nl_ack", index: 0 });
    expect(pendingNlCount(s.nl)).toBe(0);
  });
});
