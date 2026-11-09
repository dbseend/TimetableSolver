import { defineConfig } from "@playwright/test";

// 배포 주소 확인용(서버를 띄우지 않음). 비밀번호는 환경 변수로만 받는다(저장소·로그에 남기지 않음).
//   DEPLOY_URL=https://… ACCESS_USER=student ACCESS_PASSWORD=… npx playwright test -c playwright.deploy.config.ts
const baseURL = process.env.DEPLOY_URL;
if (!baseURL) throw new Error("DEPLOY_URL 환경 변수가 필요합니다.");
const password = process.env.ACCESS_PASSWORD;

export default defineConfig({
  testDir: "tests/deploy",
  timeout: 120_000,
  workers: 1,
  use: {
    baseURL,
    trace: "off",
    httpCredentials: password ? { username: process.env.ACCESS_USER ?? "student", password } : undefined,
  },
});
