import { defineConfig, devices } from "@playwright/test";

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
      command: "powershell -Command \"Set-Location ..\\backend; & .\\.venv\\Scripts\\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000\"",
      url: "http://127.0.0.1:8000/health",
      reuseExistingServer: true,
      timeout: 30000,
    },
    {
      command: "npm run start",
      url: "http://localhost:3000",
      reuseExistingServer: true,
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
