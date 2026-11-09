import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";

const INFEASIBLE = {
  status: "INFEASIBLE",
  candidates: [],
  diagnosis: {
    core: ["c1", "c2"],
    relaxations: [
      { drop: "c1", feasible: true, objective_delta: 0 },
      { drop: "c2", feasible: false, objective_delta: null },
    ],
  },
  stats: { solve_ms: 3, n_sections_after_filter: 2 },
};
const OPTIMAL = {
  status: "OPTIMAL",
  candidates: [{ sections: ["SYN101-01"], objective: 300, satisfied: ["c2"], violated: [] }],
  diagnosis: null,
  stats: { solve_ms: 2, n_sections_after_filter: 2 },
};
const RULES = [
  { id: "c1", type: "day_off", strength: "hard", params: { days: ["Mon"] }, source_text: "월요일 공강" },
  { id: "c2", type: "must_include", strength: "hard", params: { course_id: "SYN101" } },
];

describe("solve flow", () => {
  let solveBodies: { constraints: { id: string }[] }[];

  beforeEach(() => {
    localStorage.clear();
    solveBodies = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/explain")) {
          return {
            ok: true,
            json: async () => ({
              candidate_explanations: ["알파 1로 3학점이다."],
              diagnosis_text: null,
              sources: ["llm"],
            }),
          };
        }
        if (url.endsWith("/solve")) {
          const body = JSON.parse(String(init?.body));
          solveBodies.push(body);
          const json = body.constraints.length === 2 ? INFEASIBLE : OPTIMAL;
          return { ok: true, json: async () => json };
        }
        return { ok: true, json: async () => ({ status: "ok", version: "0.1.0" }) };
      }),
    );
  });

  it("loads a sample, builds a pool, shows the diagnosis and re-solves without a dropped rule", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/prepare"]}>
        <App />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "합성 50분반 불러오기" }));
    await user.type(await screen.findByRole("textbox", { name: "과목 검색" }), "SYN101");
    await user.click(screen.getByRole("button", { name: "담기" }));
    expect(screen.getByRole("list", { name: "관심 과목" })).toHaveTextContent("SYN101");

    await user.click(screen.getByRole("link", { name: "선호" }));
    const box = screen.getByRole("textbox", { name: "제약 JSON" });
    await user.clear(box);
    await user.click(box);
    await user.paste(JSON.stringify(RULES));

    await user.click(screen.getByRole("link", { name: "결과" }));
    await user.click(screen.getByRole("button", { name: "시간표 만들기" }));
    const diagnosis = await screen.findByRole("region", { name: "진단" });
    expect(diagnosis).toHaveTextContent("월요일 공강");
    expect(diagnosis).toHaveTextContent("여전히 불가능");
    expect(solveBodies[0]).toMatchObject({ pool: [{ course_id: "SYN101", priority: 3 }], n: 3 });

    await user.click(screen.getByRole("button", { name: "이 조건 빼고 다시 풀기" }));
    expect(await screen.findByRole("article", { name: "후보 1" })).toHaveTextContent("3학점");
    expect(solveBodies[1].constraints.map((c) => c.id)).toEqual(["c2"]);

    await user.click(screen.getByRole("button", { name: "설명 보기" }));
    const card = await screen.findByRole("article", { name: "후보 1" });
    expect(await within(card).findByText(/알파 1로 3학점이다/)).toBeInTheDocument();
    expect(card).toHaveTextContent("사실 확인 통과");
  });

  it("asks for a catalog before solving", async () => {
    render(
      <MemoryRouter initialEntries={["/results"]}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByText(/개설강좌를 불러온다/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "시간표 만들기" })).not.toBeInTheDocument();
  });
});
