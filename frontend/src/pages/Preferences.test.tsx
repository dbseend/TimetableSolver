import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";

const PARSED = {
  constraints: [
    { id: "c1", type: "day_off", strength: "soft", weight: 5, params: { days: ["Fri"] }, source_text: "금요일엔 수업 없었으면" },
    { id: "c2", type: "must_include", strength: "hard", weight: 10, params: { course_id: "알파" }, source_text: "알파 꼭" },
  ],
  ambiguities: [{ constraint_id: "c2", message: "'알파'가 어느 과목인지 골라야 한다", default_interpretation: null }],
  entity_candidates: [
    { mention: "알파", kind: "course", candidates: [
      { id: "SYN101", name: "가상과목 알파 1", score: 0.9 },
      { id: "SYN111", name: "가상과목 알파 2", score: 0.9 },
    ] },
  ],
};

function respond(status: number, json: unknown) {
  return { ok: status < 400, status, json: async () => json };
}

describe("preference chips", () => {
  let parseBodies: unknown[];
  let parseReply: () => ReturnType<typeof respond>;

  beforeEach(() => {
    localStorage.clear();
    parseBodies = [];
    parseReply = () => respond(200, PARSED);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/constraints/parse")) {
          parseBodies.push(JSON.parse(String(init?.body)));
          return parseReply();
        }
        return respond(200, { status: "ok", version: "0.1.0" });
      }),
    );
  });

  function open() {
    render(
      <MemoryRouter initialEntries={["/preferences"]}>
        <App />
      </MemoryRouter>,
    );
  }

  it("turns a sentence into editable chips and resolves an ambiguous course", async () => {
    const user = userEvent.setup();
    open();
    await user.type(screen.getByRole("textbox", { name: "선호 문장" }), "금공강, 알파 꼭");
    await user.click(screen.getByRole("button", { name: "해석하기" }));

    const chips = await screen.findByRole("list", { name: "조건 칩" });
    expect(within(chips).getAllByRole("listitem")).toHaveLength(2);
    expect(chips).toHaveTextContent("금 공강");
    expect(chips).toHaveTextContent("골라야 한다");

    await user.click(screen.getByRole("button", { name: "가상과목 알파 2" }));
    expect(screen.queryByRole("group", { name: "'알파' 확인" })).not.toBeInTheDocument();
    expect((screen.getByRole("textbox", { name: "제약 JSON" }) as HTMLTextAreaElement).value).toContain("SYN111");

    const stored = () =>
      JSON.parse((screen.getByRole("textbox", { name: "제약 JSON" }) as HTMLTextAreaElement).value);
    expect(stored()[0].strength).toBe("soft");
    await user.click(screen.getByRole("button", { name: "금 공강 강도" }));
    expect(stored()[0].strength).toBe("hard");
    await user.click(screen.getByRole("button", { name: "금 공강 삭제" }));
    expect(within(chips).getAllByRole("listitem")).toHaveLength(1);
  });

  it("appends a second parse with fresh ids", async () => {
    const user = userEvent.setup();
    open();
    for (const s of ["첫 문장", "둘째 문장"]) {
      await user.type(screen.getByRole("textbox", { name: "선호 문장" }), s);
      await user.click(screen.getByRole("button", { name: "해석하기" }));
      await screen.findByRole("list", { name: "조건 칩" });
    }
    const json = JSON.parse((screen.getByRole("textbox", { name: "제약 JSON" }) as HTMLTextAreaElement).value);
    expect(json.map((c: { id: string }) => c.id)).toEqual(["c1", "c2", "c3", "c4"]);
  });

  it("explains when the server has no LLM configured", async () => {
    const user = userEvent.setup();
    parseReply = () => respond(503, { error: { code: "llm_disabled", message: "off" } });
    open();
    await user.type(screen.getByRole("textbox", { name: "선호 문장" }), "금공강");
    await user.click(screen.getByRole("button", { name: "해석하기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("JSON 직접 편집");
  });
});
