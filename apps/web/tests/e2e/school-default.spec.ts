/** 기본 학교 데이터: 새 접속에서 파일 업로드 없이 학기 선택 → 학교 강좌로 시작 → 시간표 생성. (E2E는 합성 기본 카탈로그 사용) */
import { expect, test } from "@playwright/test";

test("새 접속: 학기·기준일·지원/제외 분반 표시 → 업로드 없이 학교 강좌로 생성", async ({ browser }) => {
  const context = await browser.newContext(); // 저장소·쿠키 없는 새 접속
  const page = await context.newPage();
  const posts: string[] = [];
  page.on("request", (r) => r.method() === "POST" && posts.push(r.url().split("/api/v1/")[1] ?? r.url()));
  await page.goto("/");
  const start = page.getByTestId("school-start");
  await expect(start).toBeVisible();
  await expect(page.getByTestId("school-term")).toContainText("2026-2");
  await expect(page.getByTestId("school-facts")).toContainText("2026-11-09");
  await expect(page.getByTestId("school-facts")).toContainText("2 / 4"); // 시간표에 쓰는 분반 / 전체
  await expect(page.getByTestId("school-exclusions")).toContainText("수업시간 미정");
  await expect(page.getByTestId("school-exclusions")).toContainText("교시표가 없는 요일");
  // 샘플·업로드는 보조로 남아 있음
  await expect(page.getByTestId("load-demo")).toBeVisible();
  await page.getByTestId("start-school").click();
  await expect(page.getByTestId("catalog-status")).toContainText("기본 제공");
  await expect(page.getByTestId("catalog-status")).toContainText("기준일 2026-11-09");
  await expect(page.getByTestId("partial-support")).toBeVisible();
  // 합성 기본 카탈로그 학점에 맞춘 학점 범위
  await page.getByTestId("constraint-list").getByLabel("삭제").first().click();
  await page.getByTestId("add-toggle").click();
  await page.getByTestId("ctype").selectOption("credit_range");
  await page.getByTestId("cstrength").selectOption("hard");
  await page.getByTestId("cmin").fill("3");
  await page.getByTestId("cmax").fill("4");
  await page.getByTestId("cadd").click();
  await expect(page.getByTestId("solve")).toHaveText("이 조건으로 시간표 만들기");
  await page.getByTestId("solve").click();
  await expect(page.getByTestId("results")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("compare")).toContainText("검증 통과");
  expect(posts.filter((p) => p.startsWith("catalog/validate"))).toEqual([]); // 업로드·변환 없이 서버 검증된 기본 카탈로그 사용
  expect(posts).toContain("solve");
  await context.close();
});

test("기본 학교 데이터가 없으면 안내하고 샘플·직접 업로드로 시작 가능", async ({ page }) => {
  await page.route("**/api/v1/catalogs", (r) => r.fulfill({ json: { catalogs: [] } }));
  await page.goto("/");
  await expect(page.getByTestId("school-unavailable")).toBeVisible();
  await page.getByTestId("load-demo").click();
  await expect(page.getByTestId("catalog-status")).toContainText("demo-campus-2026-2");
});
