/** 자연어 해석 결함 수정 E2E: 교수 분반 제한 유지, 빈 필수 값 직접 입력. 실제 FastAPI(fixture 모드) 사용. */
import { expect, type Page, test } from "@playwright/test";

async function loadDemo(page: Page) {
  await page.goto("/");
  await page.getByTestId("load-demo").click();
  await expect(page.getByTestId("catalog-status")).toContainText("demo-campus-2026-2");
}

const parseResponse = (drafts: unknown[], questions: unknown[] = []) => ({
  schema_version: "1.0",
  request_id: "req-mock",
  catalog_revision: "x".repeat(64),
  input_revision: 1,
  status: "needs_clarification",
  draft_constraints: drafts,
  questions,
  unsupported_requests: [],
  warnings: [],
  provider_mode: "live",
});

test("교수+과목 요구(데모 해석·실제 서버): 해당 교수 분반으로 제한되어 최종 선택까지 유지", async ({ page }) => {
  await loadDemo(page);
  await page.getByTestId("nl-input").fill("이영희 교수의 알고리즘 꼭 들을래");
  await page.getByTestId("nl-parse").click();
  const draft = page.locator("[data-testid^=draft-]").first();
  await expect(draft).toContainText("알고리즘 (CSE302) 꼭 듣기 (분반 02 중)"); // 교수 제한이 조건 문장에 드러남
  await draft.locator("[data-testid^=accept-]").click();
  await expect(page.getByTestId("constraint-list")).toContainText("분반 02 중");
  await page.getByTestId("confirm").click();
  await page.getByTestId("solve").click();
  await expect(page.getByTestId("results")).toBeVisible({ timeout: 30_000 });
  const n = Number(await page.getByTestId("candidate-count").textContent());
  for (let i = 0; i < n; i++) {
    await page.getByTestId(`cand-tab-${i}`).click();
    await expect(page.getByTestId("selected-sections")).toContainText("알고리즘 (CSE302) 02분반");
    await expect(page.getByTestId("selected-sections")).not.toContainText("알고리즘 (CSE302) 01분반");
  }
});

test("교수 분반 질문(서버 형식 응답): 답하기 전에는 추가·확인 불가, 답하면 제한된 조건으로 생성", async ({ page }) => {
  await page.route("**/api/v1/constraints/parse", (r) =>
    r.fulfill({
      json: parseResponse(
        [
          {
            draft_id: "d1",
            type: "must_include",
            strength: "hard",
            weight: null,
            params: { course_id: "CSE302", allowed_section_ids: null },
            source_text: "정우진 교수님의 알고리즘 꼭",
            unresolved_fields: ["params.allowed_section_ids"],
            action: "add",
            target_constraint_id: null,
          },
        ],
        [
          {
            id: "q-inst-d1",
            draft_id: "d1",
            field: "params.allowed_section_ids",
            message: "문장에 '정우진' 교수가 있습니다. '알고리즘'을(를) 이 교수 분반으로 제한할까요? 확인 전에는 추가할 수 없습니다.",
            options: [
              { id: "inst:P06", label: "정우진 (P06) 분반 1개로 제한", patch: { "params.allowed_section_ids": ["2026-2:CSE302:01"] } },
              { id: "any", label: "교수와 상관없이 '알고리즘' 아무 분반이나", patch: { "params.allowed_section_ids": null } },
            ],
          },
        ],
      ),
    }),
  );
  await loadDemo(page);
  await page.getByTestId("nl-input").fill("정우진 교수님의 알고리즘 꼭");
  await page.getByTestId("nl-parse").click();
  const draft = page.getByTestId("draft-d1");
  await expect(draft.getByTestId("accept-d1")).toBeDisabled();
  await expect(page.getByTestId("confirm")).toBeDisabled();
  await draft.getByRole("button", { name: /정우진 \(P06\) 분반 1개로 제한/ }).click();
  await draft.getByTestId("accept-d1").click();
  await page.getByTestId("confirm").click();
  await page.getByTestId("solve").click();
  await expect(page.getByTestId("results")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("selected-sections")).toContainText("알고리즘 (CSE302) 01분반");
});

test("빈 필수 값(최대 학점·요일)을 조건 카드에서 직접 입력 → 확정 전에는 확인·생성 불가", async ({ page }) => {
  await page.route("**/api/v1/constraints/parse", (r) =>
    r.fulfill({
      json: parseResponse([
        {
          draft_id: "d1",
          type: "credit_range",
          strength: "hard",
          weight: null,
          params: { min_units: 1500, max_units: null },
          source_text: "15~18학점으로",
          unresolved_fields: ["params.max_units"],
          action: "add",
          target_constraint_id: null,
        },
        {
          draft_id: "d2",
          type: "time_avoid",
          strength: "soft",
          weight: 5,
          params: { days: null, start_minute: 1080, end_minute: 1440 },
          source_text: "오후 6시 이후 수업은 피하고 싶어",
          unresolved_fields: ["params.days"],
          action: "add",
          target_constraint_id: null,
        },
      ]),
    }),
  );
  await loadDemo(page);
  // 기본 학점 범위를 지워 해석된 학점 범위만 남긴다
  await page.getByTestId("constraint-list").getByLabel("삭제").first().click();
  await page.getByTestId("nl-input").fill("15~18학점으로, 오후 6시 이후 수업은 피하고 싶어");
  await page.getByTestId("nl-parse").click();
  await expect(page.getByTestId("accept-d1")).toBeDisabled();
  await expect(page.getByTestId("accept-d2")).toBeDisabled();
  await expect(page.getByTestId("confirm")).toBeDisabled();
  // 잘못된 값은 거절
  const ed1 = page.getByTestId("field-editor-d1-max_units");
  await ed1.getByLabel("최대 학점").fill("12");
  await page.getByTestId("field-apply-d1-max_units").click();
  await expect(ed1).toContainText("최대 12학점보다 큽니다");
  await expect(page.getByTestId("accept-d1")).toBeDisabled();
  await ed1.getByLabel("최대 학점").fill("18");
  await page.getByTestId("field-apply-d1-max_units").click();
  await expect(page.getByTestId("draft-d1")).toContainText("총 15~18학점");
  await page.getByTestId("accept-d1").click();
  // 요일 선택
  const ed2 = page.getByTestId("field-editor-d2-days");
  for (const d of ["월", "화", "수", "목", "금"]) await ed2.getByLabel(d).check();
  await page.getByTestId("field-apply-d2-days").click();
  await expect(page.getByTestId("draft-d2")).toContainText("월·화·수·목·금 18:00~24:00와 겹치는 수업 피하기");
  await page.getByTestId("accept-d2").click();
  await expect(page.getByTestId("constraint-list")).toContainText("총 15~18학점");
  await page.getByTestId("confirm").click();
  await page.getByTestId("solve").click();
  await expect(page.getByTestId("results")).toBeVisible({ timeout: 30_000 });
});
