import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

describe("App routing", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "ok", version: "0.1.0" }) }));
  });

  it("redirects / to /prepare", () => {
    render(<MemoryRouter initialEntries={["/"]}><App /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: /수강 정보 준비/ })).toBeInTheDocument();
  });

  it.each([
    ["/preferences", /선호 입력/],
    ["/results", /결과$/],
  ])("renders %s", (path, name) => {
    render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
  });
});
