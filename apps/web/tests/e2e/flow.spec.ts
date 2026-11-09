import { expect, type Page, test } from "@playwright/test";

/** 서버로 나간 모든 요청 본문을 모아 개인정보 유출 여부를 확인한다. */
function captureBodies(page: Page): string[] {
  const bodies: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/")) bodies.push(r.postData() ?? "");
  });
  return bodies;
}

async function loadDemo(page: Page) {
  await page.goto("/");
  await page.getByTestId("load-demo").click();
  await expect(page.getByTestId("catalog-status")).toContainText("demo-campus-2026-2");
}

async function confirmAndSolve(page: Page) {
  await page.getByTestId("confirm").click();
  await page.getByTestId("solve").click();
}

async function addManual(page: Page, type: string, strength: "hard" | "soft", fill: (p: Page) => Promise<void>) {
  if (!(await page.getByTestId("ctype").isVisible())) await page.getByTestId("add-toggle").click(); // 접힌 '직접 조건 추가' 열기
  await page.getByTestId("ctype").selectOption(type);
  await page.getByTestId("cstrength").selectOption(strength);
  await fill(page);
  await page.getByTestId("cadd").click();
}

test("샘플 → 수동 조건 → 확인 → 실제 /solve → 그리드·후보 비교", async ({ page }) => {
  await loadDemo(page);
  // 확인 전에는 생성 불가
  await expect(page.getByTestId("solve")).toBeDisabled();
  await addManual(page, "day_off", "hard", async (p) => {
    await p.getByTestId("cdays").getByLabel("금").check();
  });
  await expect(page.getByTestId("constraint-list")).toContainText("금요일 공강");
  await confirmAndSolve(page);
  await expect(page.getByTestId("results")).toBeVisible({ timeout: 30_000 });
  const n = Number(await page.getByTestId("candidate-count").textContent());
  expect(n).toBeGreaterThanOrEqual(1);
  expect(n).toBeLessThanOrEqual(3);
  await expect(page.getByTestId("compare")).toContainText("검증 통과");
  await expect(page.getByTestId("grid")).toBeVisible();
  // 금요일 공강(hard): 선택 분반 목록에 금요일 수업이 없어야 한다
  await expect(page.getByTestId("selected-sections")).not.toContainText("금 ");
  // 학점 15~18
  const credits = await page.getByTestId("compare").locator("tr", { hasText: "학점" }).first().locator("td").allTextContents();
  for (const c of credits) expect(Number(c)).toBeGreaterThanOrEqual(15);

  // 조건 변경 → 확인 무효화 → 결과 초기화
  await addManual(page, "max_days_on_campus", "soft", async () => {});
  await expect(page.getByTestId("solve")).toBeDisabled();
  await expect(page.getByTestId("results")).toHaveCount(0);
});

test("불가능 → 진단 → 검증된 단일 수정안 미리보기 → 확인 후 적용 → 재풀이", async ({ page }) => {
  await loadDemo(page);
  // 캡스톤디자인(금요일만 개설) 필수 + 금요일 공강 hard → 불가능
  await addManual(page, "must_include", "hard", async (p) => {
    await p.getByTestId("ccourse").selectOption("CSE490");
  });
  await addManual(page, "day_off", "hard", async (p) => {
    await p.getByTestId("cdays").getByLabel("금").check();
  });
  await confirmAndSolve(page);
  await expect(page.getByTestId("infeasible")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("diagnose").click();
  await expect(page.getByTestId("diagnosis")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("core")).toContainText("캡스톤디자인");
  await expect(page.getByTestId("core")).toContainText("금요일 공강");
  const preview = page.locator("[data-testid^=preview-prop-]").first();
  await preview.click();
  await expect(page.getByTestId("proposal-grid")).toBeVisible();
  await page.getByTestId("apply-proposal").click();
  await expect(page.getByTestId("results")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("compare")).toContainText("검증 통과");
  // 적용된 조건은 hard→soft 또는 범위 수정 중 하나로 표시
  await expect(page.getByTestId("constraint-list")).toContainText(/가능하면|학점/);
});

test("데모 자연어 해석 → 질문/칩 → 미지원 제외 확인 → 확인 → 생성", async ({ page }) => {
  const bodies = captureBodies(page);
  await loadDemo(page);
  await expect(page.getByTestId("demo-badge")).toBeVisible();
  await page.getByTestId("nl-input").fill("금요일은 공강이면 좋겠어, 운영체제는 꼭 들어야 해, 아침 수업은 싫어, 점심시간은 꼭 비워줘");
  await page.getByTestId("nl-parse").click();
  await expect(page.getByTestId("nl-result")).toBeVisible();
  await expect(page.getByTestId("nl-unsupported")).toContainText("점심");
  // 미처리 해석이 있으면 확인 불가
  await expect(page.getByTestId("confirm")).toBeDisabled();

  const drafts = page.locator("[data-testid^=draft-]");
  const count = await drafts.count();
  expect(count).toBeGreaterThanOrEqual(3);
  // '아침' 질문: 시간대 선택 전에는 추가 불가
  const morning = drafts.filter({ hasText: "아침" });
  await expect(morning.locator("[data-testid^=accept-]")).toBeDisabled();
  await morning.getByRole("button", { name: /09:00 이전/ }).click();
  await expect(morning.locator("[data-testid^=accept-]")).toBeEnabled();
  // 모두 추가
  while ((await drafts.count()) > 0) await drafts.first().locator("[data-testid^=accept-]").click();
  await page.getByTestId("ack-0").click();
  await expect(page.getByTestId("constraint-list")).toContainText("운영체제");
  await expect(page.getByTestId("constraint-list")).toContainText("금요일 공강");
  await confirmAndSolve(page);
  await expect(page.getByTestId("results")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("selected-sections")).toContainText("운영체제");
  // 파싱 요청에는 선호 문장과 카탈로그 엔티티만 있다
  const parseBody = bodies.find((b) => b.includes('"text"'))!;
  expect(parseBody).toContain("금요일은 공강");
});

test("이수내역 로컬 처리: 원문은 서버로 가지 않고 허용 분반만 전송", async ({ page }) => {
  const bodies = captureBodies(page);
  await loadDemo(page);
  await page.getByTestId("profile-toggle").click(); // 선택 항목이라 접혀 있음
  await page.getByTestId("load-demo-transcript").click();
  await expect(page.getByTestId("profile-summary")).toContainText("4개 과목");
  await expect(page.getByTestId("profile-summary")).toContainText("제거한 열: 학번, 이름, 성적");
  await confirmAndSolve(page);
  await expect(page.getByTestId("results")).toBeVisible({ timeout: 30_000 });
  // 이수·인정한 자료구조/글쓰기와소통은 추천에서 제외
  for (let i = 0; i < Number(await page.getByTestId("candidate-count").textContent()); i++) {
    await page.getByTestId(`cand-tab-${i}`).click();
    await expect(page.getByTestId("selected-sections")).not.toContainText("자료구조");
    await expect(page.getByTestId("selected-sections")).not.toContainText("글쓰기와소통");
  }
  const all = bodies.join("\n");
  expect(all).not.toContain("20269999");
  expect(all).not.toContain("홍길동");
  expect(all).not.toContain("A0");
  const solveBody = JSON.parse(bodies.find((b) => b.includes('"allowed_section_ids"'))!);
  expect(solveBody.allowed_section_ids).not.toContain("2026-2:CSE201:01");
  expect(solveBody.allowed_section_ids).toContain("2026-2:CSE202:01");
  await page.getByTestId("clear-data").click();
  await expect(page.getByTestId("profile-summary")).toHaveCount(0);
});

test("학교 형식 CSV 업로드 → 열 매핑·교시 변환 → 같은 솔버로 생성", async ({ page }) => {
  await page.goto("/");
  const csv = [
    "학수번호,교과목명,분반,학점,이수구분,담당교수,강의시간,강의실",
    '"ABC101",회로이론,1,3,전공필수,홍교수,"월1-2,수1-2",E101',
    "ABC102,신호처리,1,3,전공선택,김교수,화3-4,E102",
    "ABC102,신호처리,2,3,전공선택,김교수,목5-6(격주),E102",
    "ABC103,논리설계,1,3,전공선택,이교수,\"목1-2,금1-2\",E103",
    "ABC104,창의설계,1,3,교양,박교수,금 13:00-15:30,E104",
    "ABC105,전자기학,1,3,전공필수,최교수,\"월3-4,수3-4\",E105",
  ].join("\n");
  await page.getByTestId("catalog-file").setInputFiles({ name: "school.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf-8") });
  await expect(page.getByTestId("mapping")).toBeVisible();
  await expect(page.getByTestId("map-course_code")).toHaveValue("학수번호");
  await expect(page.getByTestId("time-mode")).toHaveValue("schedule_text");
  await page.getByTestId("import-submit").click();
  // 교시 표기: 예시 교시표를 확인 없이 실제 값으로 쓰지 않는다
  await expect(page.getByTestId("import-issues")).toContainText("교시표");
  await page.getByTestId("period-confirm").check();
  await page.getByTestId("import-submit").click();
  await expect(page.getByTestId("import-issues")).toContainText("학기 ID"); // 학기 ID 필수
  await page.getByTestId("term-id").fill("2026-2");
  await page.getByTestId("import-submit").click();
  await expect(page.getByTestId("catalog-status")).toContainText("업로드");
  await expect(page.getByTestId("catalog-status")).toContainText("미지원 1");
  // 학점 범위를 9~15로 바꿔 생성
  await page.getByTestId("constraint-list").getByLabel("삭제").first().click();
  await addManual(page, "credit_range", "hard", async (p) => {
    await p.getByTestId("cmin").fill("9");
    await p.getByTestId("cmax").fill("15");
  });
  await confirmAndSolve(page);
  await expect(page.getByTestId("results")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("compare")).toContainText("검증 통과");
  await expect(page.getByTestId("selected-sections")).not.toContainText("신호처리 (ABC102) 2분반");
});

test("자연어 해석 실패(LLM 502) 시 안내 표시, 수동 입력과 솔버는 계속 동작", async ({ page }) => {
  // 실제 잘못된 키 호출에서 관찰한 응답 형태(502 LLM_HTTP_ERROR)를 재현한다.
  await page.route("**/api/v1/constraints/parse", (r) =>
    r.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "LLM_HTTP_ERROR", message: "자연어 해석에 실패했습니다. 수동 조건 입력은 계속 사용할 수 있습니다.", request_id: "req-x", fields: [] } }),
    }),
  );
  await loadDemo(page);
  await page.getByTestId("nl-input").fill("금요일 공강이면 좋겠어");
  await page.getByTestId("nl-parse").click();
  await expect(page.getByTestId("nl-error")).toContainText("수동 조건 입력");
  await expect(page.getByTestId("nl-error")).toContainText("LLM_HTTP_ERROR");
  await addManual(page, "day_off", "soft", async (p) => {
    await p.getByTestId("cdays").getByLabel("금").check();
  });
  await confirmAndSolve(page);
  await expect(page.getByTestId("results")).toBeVisible({ timeout: 30_000 });
});

test("포털 HTML(.xls, CP949) 합성 파일 → 형식 인식·요일별 교시표 → 가져오기", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("catalog-file").setInputFiles(new URL("../../../../fixtures/catalogs/synthetic-portal-export.xls", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  await expect(page.getByTestId("portal-detected")).toBeVisible();
  await expect(page.getByTestId("upload-meta")).toContainText("ks_c_5601-1987");
  await expect(page.getByTestId("period-table")).toHaveValue(/\[수\]/);
  await page.getByTestId("term-id").fill("2026-2");
  await page.getByTestId("period-confirm").check();
  await page.getByTestId("import-submit").click();
  await expect(page.getByTestId("catalog-status")).toContainText("과목 4");
  await expect(page.getByTestId("catalog-status")).toContainText("미지원 2");
});

test("조건 변경 후 늦게 도착한 /solve 응답은 무시하고, 계산 중 상태를 정직하게 표시", async ({ page }) => {
  await loadDemo(page);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/api/v1/solve", async (route) => {
    await gate; // 응답을 붙잡아 둔다
    await route.continue();
  });
  await confirmAndSolve(page);
  await expect(page.getByText("시간표를 계산하고 있어요")).toBeVisible();
  // 계산 중 조건 변경 → revision 증가, 확인 무효화
  await addManual(page, "max_days_on_campus", "soft", async () => {});
  release();
  await page.waitForResponse("**/api/v1/solve");
  await page.waitForTimeout(300);
  await expect(page.getByTestId("results")).toHaveCount(0); // 오래된 응답은 반영하지 않음
  await expect(page.getByTestId("solve")).toBeDisabled();
  await expect(page.getByTestId("confirm")).toBeEnabled();
});

test("네트워크 오류는 계산 실패로 표시(불가능과 구분)", async ({ page }) => {
  await loadDemo(page);
  await page.route("**/api/v1/solve", (r) => r.abort("failed"));
  await confirmAndSolve(page);
  await expect(page.getByTestId("solve-error")).toContainText("불가능하다는 뜻은 아니에요");
  await expect(page.getByTestId("solve-error")).toContainText("NETWORK");
  await expect(page.getByTestId("infeasible")).toHaveCount(0);
});

test("자연어 해석기 미설정이면 안내하고 수동 입력 유지", async ({ page }) => {
  await page.route("**/api/v1/capabilities", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, parse_provider_mode: "unavailable", live_llm_configured: false } });
  });
  await loadDemo(page);
  await expect(page.getByText("자연어 해석기가 설정되지 않았어요")).toBeVisible();
  await expect(page.getByTestId("nl-input")).toHaveCount(0);
  await expect(page.getByTestId("add-toggle")).toBeVisible();
});

test("내 전공 최소 학점: 과목 확인 전에는 차단, 확인한 과목만 '내 전공'으로 계산", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("catalog-file").setInputFiles(new URL("../../../../fixtures/catalogs/synthetic-portal-export.xls", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  await page.getByTestId("term-id").fill("2026-2");
  await page.getByTestId("period-confirm").check();
  await page.getByTestId("import-submit").click();
  await expect(page.getByTestId("catalog-status")).toBeVisible();
  await expect(page.getByTestId("major-status")).toContainText("확인하기 전에는");
  // 학점 범위 3~4 (합성 파일: SYN101 3학점, SYN102 0.5학점)
  await page.getByTestId("constraint-list").getByLabel("삭제").first().click();
  await addManual(page, "credit_range", "hard", async (p) => {
    await p.getByTestId("cmin").fill("3");
    await p.getByTestId("cmax").fill("4");
  });
  // 전공 유형(전선)을 직접 쓴 최소 학점 → 차단, 나머지 기능은 그대로
  await addManual(page, "category_min", "hard", async (p) => {
    await p.getByTestId("constraint-form").getByLabel("전선", { exact: true }).check();
    await p.getByTestId("cmin").fill("3");
  });
  await expect(page.getByTestId("confirm-reason")).toContainText("내 전공 과목을 확인");
  await expect(page.getByTestId("confirm")).toBeDisabled();
  // 내 전공 과목 확인
  await page.getByTestId("major-open").click();
  await page.getByTestId("major-panel").getByLabel("가상학부 주간").check();
  await expect(page.getByTestId("major-candidates")).toContainText("합성과목 가");
  await expect(page.getByTestId("major-apply")).toBeDisabled(); // 확인 체크 전
  await page.getByTestId("major-confirm").check();
  await page.getByTestId("major-apply").click();
  await expect(page.getByTestId("major-panel")).toContainText("확인됨");
  // 전선을 직접 쓴 조건은 여전히 차단 → 지우고 '내 전공' 그룹으로 다시 추가
  await expect(page.getByTestId("confirm-reason")).toContainText("학부와 관계없이");
  await page.getByTestId("constraint-list").getByLabel(/삭제: 전선/).click();
  await addManual(page, "category_min", "hard", async (p) => {
    await p.getByRole("button", { name: /그룹 '내 전공' 선택/ }).click();
    await p.getByTestId("cmin").fill("3");
  });
  await expect(page.getByTestId("constraint-list")).toContainText("내전공 합계 3학점 이상");
  await confirmAndSolve(page);
  await expect(page.getByTestId("results")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("selected-sections")).toContainText("합성과목 가");
});
