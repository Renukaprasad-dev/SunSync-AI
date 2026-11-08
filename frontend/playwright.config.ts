import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";

const backendDir = path.resolve(process.cwd(), "../backend");
const backendPython = process.platform === "win32"
  ? path.join(backendDir, ".venv", "Scripts", "python.exe")
  : path.join(backendDir, ".venv", "bin", "python");
const externalServers = process.env.PLAYWRIGHT_EXTERNAL_SERVERS === "1";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  fullyParallel: true,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
    headless: true,
  },
  webServer: [
    {
      command: `"${backendPython}" -m uvicorn app.main:app --host 127.0.0.1 --port 8000`,
      url: "http://127.0.0.1:8000/health",
      cwd: backendDir,
      env: {
        ...process.env,
        PYTHONPATH: backendDir,
        STORAGE_MODE: "local_file",
        LOCAL_STORE_PATH: path.join(os.tmpdir(), "sunsync_playwright_store.json"),
        SESSION_SIGNING_SECRET: "playwright-only-secret-never-used-outside-tests-32-bytes",
        SESSION_TOKEN_TTL_SECONDS: "3600",
        SESSION_ISSUANCE_MAX_REQUESTS: "200",
        SUPABASE_URL: "",
        SUPABASE_SERVICE_ROLE_KEY: "",
      },
      reuseExistingServer: externalServers,
      timeout: 30000,
    },
    {
      command: "node ./node_modules/next/dist/bin/next start",
      url: "http://localhost:3000",
      reuseExistingServer: externalServers,
      timeout: 60000,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
