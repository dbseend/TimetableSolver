import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
// E2E는 별도 포트의 fixture 백엔드를 쓴다(비밀 아님: 로컬 주소만).
const apiTarget = process.env.API_TARGET ?? "http://127.0.0.1:8000";
const port = Number(process.env.WEB_PORT ?? 5173);

export default defineConfig({
  plugins: [react()],
  server: {
    port,
    strictPort: true,
    // 샘플 CSV는 repo의 fixtures/에서 ?raw로 읽는다(학교 CSV와 같은 import 경로를 탄다).
    fs: { allow: [repoRoot] },
    proxy: { "/api": { target: apiTarget, changeOrigin: false } },
  },
  test: { include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"], environment: "node" },
});
