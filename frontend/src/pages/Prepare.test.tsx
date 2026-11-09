import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";

const CATALOG_DATA = {
  courses: [
    { id: "SYN101", name: "가상과목 알파 1", credit: 3, category: "교양", prerequisites: [] },
  ],
  sections: [
    {
      id: "SYN101-01",
      course_id: "SYN101",
      meetings: [{ day: "Mon", start: "09:00", end: "10:15" }],
      instructor: "가상교수",
      capacity: 30,
    },
  ],
};

function respond(status: number, json: unknown) {
  return { ok: status < 400, status, json: async () => json };
}

describe("prepare page semester selection", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/health")) {
          return respond(200, { status: "ok", version: "0.1.0" });
        }
        if (url.endsWith("/semesters")) {
          return respond(200, {
            semesters: [{ id: "synthetic-50", label: "합성 50분반", is_synthetic: true }],
          });
        }
        if (url.includes("/catalog/synthetic-50")) {
          return respond(200, CATALOG_DATA);
        }
        return respond(404, { error: { code: "not_found", message: "not found" } });
      }),
    );
  });

  it("fetches and renders semesters, and clicking loads the catalog", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/prepare"]}>
        <App />
      </MemoryRouter>,
    );

    // Verify semester button is rendered
    const semesterBtn = await screen.findByRole("button", {
      name: "합성 50분반 (synthetic-50)",
    });
    expect(semesterBtn).toBeInTheDocument();

    // Click to load catalog
    await user.click(semesterBtn);

    // Catalog info should be displayed
    await waitFor(() => {
      expect(screen.getByText(/과목 1개, 분반 1개/)).toBeInTheDocument();
    });
  });
});
