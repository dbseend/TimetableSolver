/** 배포 주소에서 실제 흐름 확인: 첫 접속 → 기본 데이터 → 조건 → 생성 → 뒤로 → 조건 수정 → 재생성. Gemini 호출 없음(직접 조건 추가만). */
import { expect, type Page, test } from "@playwright/test";

async function addDayOff(page: Page, day: string) {
  if (!(await page.getByTestId("ctype").isVisible())) await page.getByTestId("add-toggle").click();
  await page.getByTestId("ctype").selectOption("day_off");
  await page.getByTestId("cstrength").selectOption("soft");
  await page.getByTestId("cdays").getByLabel(day).check();
  await page.getByTestId("cadd").click();
}

test("health·HTTPS·같은 주소 API", async ({ request, baseURL }) => {
  const r = await request.get("/api/v1/health");
  expect(r.status()).toBe(200);
  expect(await r.json()).toEqual({ status: "ok" });
  if (!/127\.0\.0\.1|localhost/.test(baseURL!)) expect(baseURL!.startsWith("https://")).toBe(true);
  const list = await (await request.get("/api/v1/catalogs")).json();
  expect(list.catalogs.some((c: { valid: boolean }) => c.valid)).toBe(true);
});

test("첫 접속 → 기본 데이터 → 조건 → 생성 → 뒤로 → 조건 수정 → 재생성", async ({ page }) => {
  const apiHosts = new Set<string>();
  page.on("request", (r) => r.url().includes("/api/v1/") && apiHosts.add(new URL(r.url()).origin));
  await page.goto("/");
  await expect(page.getByTestId("school-start")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("start-school").click();
  await expect(page.getByTestId("catalog-status")).toContainText("기본 제공", { timeout: 60_000 });
  await expect(page).toHaveURL(/#\/conditions$/);
  await addDayOff(page, "금");
  await page.getByTestId("solve").click();
  await expect(page.getByTestId("results")).toBeVisible({ timeout: 60_000 });
  await expect(page).toHaveURL(/#\/results$/);
  // 브라우저 뒤로 → 조건 화면, 입력 유지
  await page.goBack();
  await expect(page).toHaveURL(/#\/conditions$/);
  await expect(page.getByTestId("constraint-list")).toContainText("금요일 공강");
  // 조건 수정 → 이전 결과는 '다시 생성' 안내
  await addDayOff(page, "월");
  await expect(page.getByTestId("results-stale")).toContainText("조건이 변경되어 다시 생성해야 합니다");
  await expect(page.getByTestId("step-results")).toBeDisabled();
  await page.getByTestId("solve").click();
  await expect(page.getByTestId("results")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("results-stale")).toHaveCount(0);
  // 앱 버튼으로도 조건 수정하기
  await page.getByTestId("back-to-conditions").click();
  await expect(page.getByTestId("constraint-list")).toContainText(/월(요일|·)/);
  expect([...apiHosts]).toEqual([new URL(page.url()).origin]); // API는 같은 주소(localhost 아님)
});
