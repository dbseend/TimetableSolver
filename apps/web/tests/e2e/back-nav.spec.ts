/** 이전 단계 이동·브라우저 뒤로가기·결과 유효성·처음부터 다시 시작. 실제 FastAPI(fixture) 사용, Gemini 호출 없음. */
import { expect, type Page, test } from "@playwright/test";

async function loadDemo(page: Page) {
  await page.goto("/");
  await page.getByTestId("load-demo").click();
  await expect(page.getByTestId("catalog-status")).toContainText("demo-campus-2026-2");
}
async function addManual(page: Page, type: string, strength: "hard" | "soft", fill: (p: Page) => Promise<void>) {
  if (!(await page.getByTestId("ctype").isVisible())) await page.getByTestId("add-toggle").click();
  await page.getByTestId("ctype").selectOption(type);
  await page.getByTestId("cstrength").selectOption(strength);
  await fill(page);
  await page.getByTestId("cadd").click();
}
async function generate(page: Page) {
  await expect(page.getByTestId("solve")).toHaveText("이 조건으로 시간표 만들기");
  await page.getByTestId("solve").click();
  await expect(page.getByTestId("results")).toBeVisible({ timeout: 30_000 });
}

test("결과 → 조건 수정하기 → 조건·선택 후보 유지 → 결과로 복귀 → 재생성", async ({ page }) => {
  const solves: string[] = [];
  page.on("request", (r) => r.url().endsWith("/api/v1/solve") && solves.push(r.url()));
  await loadDemo(page);
  await addManual(page, "day_off", "soft", async (p) => {
    await p.getByTestId("cdays").getByLabel("금").check();
  });
  await generate(page);
  await expect(page).toHaveURL(/#\/results$/);
  await page.getByTestId("cand-tab-1").click();
  await page.getByTestId("back-to-conditions").click();
  await expect(page).toHaveURL(/#\/conditions$/);
  await expect(page.getByTestId("constraint-list")).toContainText("금요일 공강");
  // 바꾸지 않았으면 결과는 그대로(선택 후보 포함) — 단계 표시로 결과로 돌아갈 수 있다
  await page.getByTestId("step-results").click();
  await expect(page).toHaveURL(/#\/results$/);
  await expect(page.getByTestId("cand-tab-1")).toHaveAttribute("aria-selected", "true");
  expect(solves).toHaveLength(1);
  // 다시 조건으로 → 그대로 재생성
  await page.getByTestId("back-to-conditions").click();
  await generate(page);
  expect(solves).toHaveLength(2);
});

test("조건 변경 시 이전 결과를 최신처럼 보이지 않고 '다시 생성' 안내, 결과 단계 진입 불가", async ({ page }) => {
  await loadDemo(page);
  await generate(page);
  await page.getByTestId("back-to-conditions").click();
  await addManual(page, "max_days_on_campus", "soft", async () => {});
  await expect(page.getByTestId("results")).toHaveCount(0);
  await expect(page.getByTestId("results-stale")).toContainText("조건이 변경되어 다시 생성해야 합니다");
  await expect(page.getByTestId("step-results")).toBeDisabled();
  await generate(page);
  await expect(page.getByTestId("results-stale")).toHaveCount(0);
});

test("확인할 조건이 남으면 결과 단계로 건너뛸 수 없다", async ({ page }) => {
  await loadDemo(page);
  await page.getByTestId("constraint-list").getByLabel(/삭제: 총 15~18학점/).click(); // 학점 범위 누락 → 확인할 조건
  await expect(page.getByTestId("solve")).toHaveText("조건 1개 확인하기");
  await expect(page.getByTestId("step-results")).toBeDisabled();
  await page.goto(page.url().replace(/#.*$/, "#/results")); // 주소로 직접 가도
  await expect(page.getByTestId("step-results")).toBeDisabled();
  await expect(page).not.toHaveURL(/#\/results$/);
});

test("조건 → 강좌 준비 → 같은 데이터 유지하고 복귀(조건·확인 항목·이수내역 유지)", async ({ page }) => {
  await loadDemo(page);
  await page.getByTestId("profile-toggle").click();
  await page.getByTestId("load-demo-transcript").click();
  await expect(page.getByTestId("profile-summary")).toContainText("4개 과목");
  await addManual(page, "day_off", "soft", async (p) => {
    await p.getByTestId("cdays").getByLabel("수").check();
  });
  await page.getByTestId("constraint-list").getByLabel(/삭제: 총 15~18학점/).click(); // 확인할 조건 1개 만들기
  await page.getByTestId("back-to-prepare").click();
  await expect(page).toHaveURL(/#\/prepare$/);
  await expect(page.getByTestId("data-prep")).toBeVisible();
  await page.getByTestId("keep-data").click();
  await expect(page).toHaveURL(/#\/conditions$/);
  await expect(page.getByTestId("constraint-list")).toContainText("수요일 공강");
  await expect(page.getByTestId("review-count")).toContainText("확인할 조건 1개");
  await expect(page.getByTestId("profile-summary")).toContainText("4개 과목");
  // 같은 데이터를 다시 골라도 조건은 그대로
  await page.getByTestId("step-prepare").click();
  await page.getByTestId("load-demo").click();
  await expect(page.getByTestId("constraint-list")).toContainText("수요일 공강");
  await expect(page.getByTestId("catalog-change-notice")).toHaveCount(0);
});

test("다른 데이터(학교 기본 데이터)로 바꾸면 조건 유효성을 다시 검사하고 제외한 조건을 알린다", async ({ page }) => {
  await loadDemo(page);
  await addManual(page, "must_include", "hard", async (p) => {
    await p.getByTestId("ccourse").selectOption("CSE301");
  });
  await addManual(page, "day_off", "soft", async (p) => {
    await p.getByTestId("cdays").getByLabel("금").check();
  });
  await page.getByTestId("back-to-prepare").click();
  await page.getByTestId("start-school").click(); // E2E에서는 합성 기본 카탈로그
  await expect(page.getByTestId("catalog-status")).toContainText("기본 제공");
  await expect(page.getByTestId("catalog-change-notice")).toContainText("운영체제");
  await expect(page.getByTestId("constraint-list")).not.toContainText("운영체제");
  await expect(page.getByTestId("constraint-list")).toContainText("금요일 공강");
  await expect(page.getByTestId("constraint-list")).toContainText("총 15~18학점");
});

test("상세·수정안 미리보기 닫기", async ({ page }) => {
  await loadDemo(page);
  await addManual(page, "must_include", "hard", async (p) => {
    await p.getByTestId("ccourse").selectOption("CSE490");
  });
  await addManual(page, "day_off", "hard", async (p) => {
    await p.getByTestId("cdays").getByLabel("금").check();
  });
  await page.getByTestId("solve").click();
  await page.getByTestId("diagnose").click();
  await page.locator("[data-testid^=preview-prop-]").first().click();
  await expect(page.getByTestId("proposal-grid")).toBeVisible();
  await page.getByTestId("preview-close").click();
  await expect(page.getByTestId("proposal-grid")).toHaveCount(0);
  // 수업 상세
  await page.goto("/");
  await page.getByTestId("load-demo").click();
  await generate(page);
  await page.locator(".tt-block").first().click();
  await expect(page.getByTestId("section-detail")).toBeVisible();
  await page.getByTestId("section-detail").getByRole("button", { name: "닫기" }).click();
  await expect(page.getByTestId("section-detail")).toHaveCount(0);
});

test("브라우저 뒤로가기·앞으로가기가 앱 단계와 맞고 입력이 유지된다", async ({ page }) => {
  await loadDemo(page);
  await addManual(page, "day_off", "soft", async (p) => {
    await p.getByTestId("cdays").getByLabel("월").check();
  });
  await generate(page);
  const origin = new URL(page.url()).origin;
  await page.goBack();
  await expect(page).toHaveURL(/#\/conditions$/);
  expect(new URL(page.url()).origin).toBe(origin);
  await expect(page.getByTestId("constraint-list")).toContainText("월요일 공강");
  await page.goBack();
  await expect(page).toHaveURL(/#\/prepare$/);
  await expect(page.getByTestId("data-prep")).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/#\/conditions$/);
  await page.goForward();
  await expect(page).toHaveURL(/#\/results$/);
  await expect(page.getByTestId("results")).toBeVisible();
});

test("처음부터 다시 시작은 지워질 내용을 알리고 확인받는다", async ({ page }) => {
  await loadDemo(page);
  await addManual(page, "day_off", "soft", async (p) => {
    await p.getByTestId("cdays").getByLabel("금").check();
  });
  await page.getByTestId("restart").click();
  await expect(page.getByTestId("restart-confirm")).toContainText("조건 2개");
  await page.getByTestId("restart-no").click();
  await expect(page.getByTestId("constraint-list")).toContainText("금요일 공강");
  await page.getByTestId("restart").click();
  await page.getByTestId("restart-yes").click();
  await expect(page).toHaveURL(/#\/prepare$/);
  await expect(page.getByTestId("school-start")).toBeVisible();
  await expect(page.getByText("강좌 데이터 없음")).toBeVisible();
});

test("모바일(390px)에서도 이전 이동 버튼 사용 가능", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadDemo(page);
  await generate(page); // 결과 탭으로 이동
  await expect(page.getByTestId("back-to-conditions")).toBeVisible();
  await page.getByTestId("back-to-conditions").click();
  await expect(page.getByTestId("back-to-prepare")).toBeVisible();
  const box = await page.getByTestId("back-to-prepare").boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await page.getByTestId("back-to-prepare").click();
  await expect(page.getByTestId("data-prep")).toBeVisible();
  await page.getByTestId("keep-data").click();
  await expect(page.getByTestId("solve")).toBeVisible();
});
