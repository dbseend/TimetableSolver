import { defineConfig } from "@playwright/test";

// E2E 전용 서버: 실제 FastAPI(fixture 해석기, 포트 8010) + Vite(포트 5174).
// 개발용 서버(8000/5173, live Gemini일 수 있음)와 분리해 외부 LLM을 호출하지 않고 결정적으로 돌린다.
const env = { ...process.env, LLM_PROVIDER: "fixture", GEMINI_API_KEY: "", ENABLE_DEMO_FIXTURES: "1", CORS_ORIGINS: "http://127.0.0.1:5174" };

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  workers: 1, // 백엔드 solver 동시 실행 1 → 직렬 실행
  use: { baseURL: "http://127.0.0.1:5174", trace: "retain-on-failure" },
  webServer: [
    {
      command: "uv run uvicorn app.main:app --host 127.0.0.1 --port 8010",
      cwd: "../../services/api",
      url: "http://127.0.0.1:8010/api/v1/health",
      reuseExistingServer: false,
      timeout: 60_000,
      env,
    },
    {
      command: "npx vite --host 127.0.0.1",
      url: "http://127.0.0.1:5174",
      reuseExistingServer: false,
      timeout: 60_000,
      env: { ...process.env, API_TARGET: "http://127.0.0.1:8010", WEB_PORT: "5174" },
    },
  ],
});
