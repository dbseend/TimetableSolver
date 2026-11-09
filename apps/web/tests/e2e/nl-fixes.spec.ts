/**
 * 자연어 해석 결과의 '확인할 조건' UX (생성 버튼 바로 위). 실제 FastAPI(fixture 모드) + 서버 형식 응답 mock.
 * 실제 Gemini 호출 없음.
 */
import { expect, type Page, test } from "@playwright/test";

async function loadDemo(page: Page) {
  await page.goto("/");
  await page.getByTestId("load-demo").click();
  await expect(page.getByTestId("catalog-status")).toContainText("demo-campus-2026-2");
}

const draft = (id: string, type: string, strength: string | null, params: Record<string, unknown>, source: string, unresolved: string[] = []) => ({
  draft_id: id,
  type,
  strength,
  weight: strength === "soft" ? 5 : null,
  params,
  source_text: source,
  unresolved_fields: unresolved,
  action: "add",
  target_constraint_id: null,
});

const parseResponse = (drafts: unknown[], questions: unknown[] = [], unsupported: unknown[] = [], warnings: string[] = []) => ({
  schema_version: "1.0",
  request_id: "req-mock",
  catalog_revision: "x".repeat(64),
  input_revision: 1,
  status: "needs_clarification",
  draft_constraints: drafts,
  questions,
  unsupported_requests: unsupported,
  warnings,
  provider_mode: "live",
});

function countSolves(page: Page) {
  const calls: string[] = [];
  page.on("request", (r) => r.url().endsWith("/api/v1/solve") && calls.push(r.url()));
  return calls;
}

async function parse(page: Page, text: string) {
  await page.getByTestId("nl-input").fill(text);
  await page.getByTestId("nl-parse").click();
  await expect(page.getByTestId("nl-result")).toBeVisible();
}

test("[1·5] 교수+과목(데모 해석·실제 서버): 완전한 해석은 바로 반영, 버튼 한 번으로 생성, 교수 분반 유지", async ({ page }) => {
  await loadDemo(page);
  await parse(page, "이영희 교수의 알고리즘 꼭 들을래");
  await expect(page.getByTestId("constraint-list")).toContainText("알고리즘 (CSE302) 꼭 듣기 (분반 02 중)");
  await expect(page.getByTestId("review-count")).toContainText("조건이 모두 준비됐어요");
  await expect(page.getByTestId("final-summary")).toContainText("분반 02 중");
  await page.getByTestId("solve").click();
  await expect(page.getByTestId("results")).toBeVisible({ timeout: 30_000 });
  const n = Number(await page.getByTestId("candidate-count").textContent());
  for (let i = 0; i < n; i++) {
    await page.getByTestId(`cand-tab-${i}`).click();
    await expect(page.getByTestId("selected-sections")).toContainText("알고리즘 (CSE302) 02분반");
    await expect(page.getByTestId("selected-sections")).not.toContainText("알고리즘 (CSE302) 01분반");
  }
});

test("[5] 교수 분반 모호(서버 질문): 버튼 위 카드에서 선택 → 반영 → 생성, 최종 분반 제한 유지", async ({ page }) => {
  const solves = countSolves(page);
  await page.route("**/api/v1/constraints/parse", (r) =>
    r.fulfill({
      json: parseResponse(
        [draft("d1", "must_include", "hard", { course_id: "CSE302", allowed_section_ids: null }, "정우진 교수님의 알고리즘 꼭", ["params.allowed_section_ids"])],
        [
          {
            id: "q-inst-d1",
            draft_id: "d1",
            field: "params.allowed_section_ids",
            message: "문장에 '정우진' 교수가 있습니다. '알고리즘'을(를) 이 교수 분반으로 제한할까요?",
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
  await parse(page, "정우진 교수님의 알고리즘 꼭");
  const item = page.getByTestId("review-item-0");
  await expect(item).toContainText("“정우진 교수님의 알고리즘 꼭”");
  await expect(item).toContainText("어느 교수의 분반으로 제한할지");
  await expect(page.getByTestId("solve")).toHaveText("조건 1개 확인하기");
  // 고르지 않고 반영하면 해당 질문 바로 아래 오류
  await item.getByTestId("ri0-apply").click();
  await expect(item).toContainText("하나를 골라 주세요");
  expect(solves).toEqual([]);
  await item.getByLabel(/정우진 \(P06\) 분반 1개로 제한/).check();
  await item.getByTestId("ri0-apply").click();
  await expect(page.getByTestId("constraint-list")).toContainText("알고리즘 (CSE302) 꼭 듣기 (분반 01 중)");
  await page.getByTestId("solve").click();
  await expect(page.getByTestId("results")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("selected-sections")).toContainText("알고리즘 (CSE302) 01분반");
  expect(solves).toHaveLength(1);
});

test("[2·4·7] 여러 미해결(최대 학점·회피 요일): 개수·이동·포커스, 필드 아래 오류, 제안값 표시, 마지막 해결 후 생성", async ({ page }) => {
  const solves = countSolves(page);
  await page.route("**/api/v1/constraints/parse", (r) =>
    r.fulfill({
      json: parseResponse([
        draft("d1", "credit_range", "hard", { min_units: 1500, max_units: null }, "15학점 이상", ["params.max_units"]),
        draft("d2", "time_avoid", "soft", { days: null, start_minute: 1080, end_minute: 1440 }, "저녁 수업은 피하고 싶어요", ["params.days"]),
      ]),
    }),
  );
  await loadDemo(page);
  await page.getByTestId("constraint-list").getByLabel(/삭제: 총 15~18학점/).click(); // 기본 학점 범위를 지워 해석된 학점으로
  await parse(page, "15학점 이상, 저녁 수업은 피하고 싶어요");
  await expect(page.getByTestId("review-count")).toContainText("확인할 조건 2개");
  await expect(page.getByTestId("solve")).toHaveText("조건 2개 확인하기");
  // 주요 버튼 → 첫 항목의 첫 입력으로 포커스(생성 요청 없음)
  await page.getByTestId("solve").click();
  const first = page.getByTestId("review-item-0");
  await expect(first).toContainText("총 학점 범위를 확인해 주세요");
  await expect(first.getByLabel("최대 학점")).toBeFocused();
  expect(solves).toEqual([]);
  // 잘못된 값 → 그 필드 바로 아래 오류, 반영 안 됨
  await first.getByLabel("최대 학점").fill("12");
  await first.getByTestId("ri0-apply").click();
  await expect(first.getByTestId("ri0-max_units")).toContainText("최대 12학점보다 큽니다");
  await expect(page.getByTestId("review-count")).toContainText("확인할 조건 2개");
  await first.getByLabel("최대 학점").fill("18");
  await first.getByTestId("ri0-apply").click();
  // 해결된 항목은 목록으로 이동, 다음 항목이 첫 번째가 되고 포커스 이동
  await expect(page.getByTestId("constraint-list")).toContainText("총 15~18학점");
  await expect(page.getByTestId("review-count")).toContainText("확인할 조건 1개");
  const next = page.getByTestId("review-item-0");
  await expect(next).toContainText("피하고 싶은 시간과 요일");
  await expect(next.locator("input").first()).toBeFocused();
  // 말하지 않은 요일은 '제안값'으로만 표시(반영 버튼을 눌러야 적용)
  await expect(next.getByTestId("ri0-days")).toContainText("제안값");
  await next.getByTestId("ri0-days").getByLabel("월").uncheck(); // 사용자가 제안을 고침
  await next.getByTestId("ri0-apply").click();
  await expect(page.getByTestId("constraint-list")).toContainText("화·수·목·금 18:00~24:00와 겹치는 수업 피하기");
  await expect(page.getByTestId("review-count")).toContainText("조건이 모두 준비됐어요");
  await expect(page.getByTestId("solve")).toBeFocused(); // 마지막 해결 후 생성 버튼으로
  await expect(page.getByTestId("solve")).toHaveText("이 조건으로 시간표 만들기");
  await page.getByTestId("solve").click();
  await expect(page.getByTestId("results")).toBeVisible({ timeout: 30_000 });
  expect(solves).toHaveLength(1);
});

test("[3·8] 서버가 합친 학점 범위(12~15)가 기존 15~18과 다르면 덮어쓰지 않고 선택 → 하나의 범위로 생성", async ({ page }) => {
  await page.route("**/api/v1/constraints/parse", (r) =>
    r.fulfill({
      json: parseResponse([draft("d1", "credit_range", "hard", { min_units: 1200, max_units: 1500 }, "12학점 이상 / 15학점 이하")], [], [], [
        "'12학점 이상 / 15학점 이하'의 최소·최대 학점을 하나의 학점 범위(12~15학점)로 합쳤습니다.",
      ]),
    }),
  );
  await loadDemo(page);
  await parse(page, "12학점 이상, 15학점 이하로");
  await expect(page.getByTestId("nl-result")).toContainText("하나의 학점 범위(12~15학점)로 합쳤습니다");
  const item = page.getByTestId("review-item-0");
  await expect(item.getByTestId("ri0-compare")).toContainText("총 15~18학점");
  await expect(item.getByTestId("ri0-compare")).toContainText("총 12~15학점");
  // 고르기 전에는 기존 조건 그대로
  await expect(page.getByTestId("constraint-list")).toContainText("총 15~18학점");
  await expect(item.getByTestId("ri0-apply")).toBeDisabled();
  await item.getByTestId("ri0-replace").check();
  await item.getByTestId("ri0-apply").click();
  await expect(page.getByTestId("constraint-list")).toContainText("총 12~15학점");
  await expect(page.getByTestId("constraint-list")).not.toContainText("총 15~18학점"); // 학점 범위는 하나
  await page.getByTestId("solve").click();
  await expect(page.getByTestId("results")).toBeVisible({ timeout: 30_000 });
  const credits = await page.getByTestId("compare").locator("tr", { hasText: "학점" }).first().locator("td").allTextContents();
  for (const c of credits) expect(Number(c)).toBeLessThanOrEqual(15);
});

test("[8] 충돌에서 '기존 조건 유지'와 '직접 수정'", async ({ page }) => {
  let n = 0;
  await page.route("**/api/v1/constraints/parse", (r) => {
    n += 1;
    return r.fulfill({ json: parseResponse([draft(`d${n}`, "credit_range", "hard", { min_units: 900, max_units: 1200 }, "9~12학점")]) });
  });
  await loadDemo(page);
  await parse(page, "9~12학점");
  await page.getByTestId("review-item-0").getByTestId("ri0-keep").check();
  await page.getByTestId("review-item-0").getByTestId("ri0-apply").click();
  await expect(page.getByTestId("constraint-list")).toContainText("총 15~18학점");
  await expect(page.getByTestId("review-count")).toContainText("조건이 모두 준비됐어요");
  // 다시 요청 → 직접 수정(12~16)
  await parse(page, "9~12학점");
  const item = page.getByTestId("review-item-0");
  await item.getByTestId("ri0-edit").check();
  await item.getByLabel("최소 학점").fill("12");
  await item.getByLabel("최대 학점").fill("16");
  await item.getByTestId("ri0-edit-apply").click();
  await expect(page.getByTestId("constraint-list")).toContainText("총 12~16학점");
});
