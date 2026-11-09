import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HealthStatus from "./HealthStatus";

describe("HealthStatus", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows connected on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "ok", version: "0.1.0" }) }));
    render(<HealthStatus />);
    await act(async () => {});
    expect(screen.getByRole("status")).toHaveTextContent("서버 연결됨");
  });

  it("shows waking message when slow, then connected", async () => {
    let resolve!: (v: unknown) => void;
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise((r) => (resolve = r))));
    render(<HealthStatus />);
    await act(async () => {
      vi.advanceTimersByTime(3100);
    });
    expect(screen.getByRole("status")).toHaveTextContent("서버를 깨우는 중");
    await act(async () => {
      resolve({ ok: true, json: async () => ({ status: "ok", version: "0.1.0" }) });
    });
    expect(screen.getByRole("status")).toHaveTextContent("서버 연결됨");
  });

  it("shows error on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
    render(<HealthStatus />);
    await act(async () => {});
    expect(screen.getByRole("status")).toHaveTextContent("연결할 수 없음");
  });
});
