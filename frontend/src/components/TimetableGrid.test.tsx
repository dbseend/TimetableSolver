import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Catalog } from "../api/client";
import TimetableGrid, { blocksFor } from "./TimetableGrid";

const catalog: Catalog = {
  courses: [{ id: "A", name: "가상 알파", credit: 3, category: "전선" }],
  sections: [
    { id: "A-01", course_id: "A", meetings: [{ day: "Mon", start: "09:00", end: "10:15" }] },
    { id: "A-02", course_id: "A", meetings: [{ day: "Sat", start: "22:30", end: "23:45" }] },
  ],
};

describe("TimetableGrid", () => {
  it("draws each meeting as a labelled block, weekdays only by default", () => {
    render(<TimetableGrid blocks={blocksFor(catalog, ["A-01"])} />);
    expect(screen.getByRole("cell", { name: "월 09:00–10:15 가상 알파" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "토" })).not.toBeInTheDocument();
  });

  it("adds Saturday and late hours when needed", () => {
    render(<TimetableGrid blocks={blocksFor(catalog, ["A-02"])} />);
    expect(screen.getByRole("columnheader", { name: "토" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "토 22:30–23:45 가상 알파" })).toBeInTheDocument();
  });

  it("ignores unknown section ids", () => {
    expect(blocksFor(catalog, ["NOPE"])).toEqual([]);
  });
});
