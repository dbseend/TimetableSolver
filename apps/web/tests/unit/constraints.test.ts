import { describe, expect, it } from "vitest";
import type { DraftConstraint, SolveResponse } from "../../src/lib/types";
import { applyPatch, draftToConstraint, hardCreditRangeProblem, isResolved } from "../../src/features/constraints/model";
import { initialState, pendingNlCount, reducer } from "../../src/app/state";
import { validateFieldValue } from "../../src/features/constraints/FieldEditor";

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


describe("빈 필수 값 직접 입력 검증", () => {
  const credit = draft({ type: "credit_range", strength: "hard", params: { min_units: 1500, max_units: null }, unresolved_fields: ["params.max_units"] });
  it("accepts a valid max credit and resolves the draft", () => {
    const r = validateFieldValue(credit, "params.max_units", "18");
    expect(r).toEqual({ value: 1800 });
    const next = applyPatch(credit, "params.max_units", { "params.max_units": 1800 })!;
    expect(isResolved(next)).toBe(true);
    expect(draftToConstraint(next, "c5")).toMatchObject({ params: { min_units: 1500, max_units: 1800 } });
  });
  it("rejects max below min, bad precision, and non-positive min credit", () => {
    expect(validateFieldValue(credit, "params.max_units", "12")).toHaveProperty("error");
    expect(validateFieldValue(credit, "params.max_units", "18.005")).toHaveProperty("error");
    const noMin = draft({ type: "credit_range", strength: "hard", params: { min_units: null, max_units: 1800 }, unresolved_fields: ["params.min_units"] });
    expect(validateFieldValue(noMin, "params.min_units", "0")).toHaveProperty("error");
  });
  it("time and day fields: start < end, at least one day, weekday order", () => {
    const t = draft({ params: { days: null, start_minute: 1080, end_minute: 1440 }, unresolved_fields: ["params.days"] });
    expect(validateFieldValue(t, "params.days", [])).toHaveProperty("error");
    expect(validateFieldValue(t, "params.days", ["Fri", "Mon"])).toEqual({ value: ["Mon", "Fri"] });
    const s = draft({ params: { days: ["Mon"], start_minute: null, end_minute: 600 }, unresolved_fields: ["params.start_minute"] });
    expect(validateFieldValue(s, "params.start_minute", "11:00")).toHaveProperty("error");
    expect(validateFieldValue(s, "params.start_minute", "09:00")).toEqual({ value: 540 });
  });
  it("an instructor-section question option (server mapping) resolves allowed_section_ids", () => {
    const inc = draft({ type: "must_include", strength: "hard", params: { course_id: "ALG", allowed_section_ids: null }, unresolved_fields: ["params.allowed_section_ids"] });
    expect(isResolved(inc)).toBe(false);
    const r = applyPatch(inc, "params.allowed_section_ids", { "params.allowed_section_ids": ["ALG-01", "ALG-03"] })!;
    expect(draftToConstraint(r, "c9")).toMatchObject({ params: { course_id: "ALG", allowed_section_ids: ["ALG-01", "ALG-03"] } });
    const any = applyPatch(inc, "params.allowed_section_ids", { "params.allowed_section_ids": null })!;
    expect(isResolved(any)).toBe(true); // '아무 분반'은 사용자가 명시적으로 고른 경우에만 해결
  });
});
