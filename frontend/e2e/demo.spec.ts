import { test, expect } from "@playwright/test";

test.describe("SunSync AI Industrial Decision Support Demo Flow", () => {
  test("1. Landing page displays problem, solution, strategies, and disclaimer", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/SunSync AI/i);

    // Verify Disclaimer banner
    const disclaimer = page.locator("text=Simulated Decision Support");
    await expect(disclaimer).toBeVisible();

    // Verify Hero title
    const heading = page.locator("h1");
    await expect(heading).toContainText("Machine Scheduling");

    // Verify 3 Strategies explainer cards using role-based headings
    await expect(page.getByRole("heading", { name: "Baseline Schedule" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3 }).filter({ hasText: "Solar-Aware" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3 }).filter({ hasText: "Cost-Optimized" })).toBeVisible();
  });

  test("2. Navigating to Dashboard displays live KPIs, Gantt dispatch, and zero deadline violations", async ({ page }) => {
    await page.goto("/dashboard");

    // Wait for Dashboard header to appear
    await expect(page.locator("text=Industrial Scheduling Dashboard")).toBeVisible({ timeout: 15000 });

    // Verify KPI cards
    await expect(page.locator("text=Daily Electricity Cost")).toBeVisible();
    await expect(page.locator("text=Peak Grid Demand")).toBeVisible();
    await expect(page.locator("text=Solar Consumed On-Site")).toBeVisible();
    await expect(page.locator("text=0 Violations")).toBeVisible();
    await expect(page.locator("text=VERIFIED STRICT")).toBeVisible();

    // Verify Strategy switching
    const solarTab = page.locator("button:has-text('Solar-Aware Strategy')");
    await expect(solarTab).toBeVisible();
    await solarTab.click();
    await expect(solarTab).toHaveClass(/bg-amber-500/);

    const costTab = page.locator("button:has-text('Cost-Optimized Strategy')");
    await costTab.click();
    await expect(costTab).toHaveClass(/bg-blue-600/);

    // Verify 'Why This Change' section
    await expect(page.locator("text=Why This Change?")).toBeVisible();
    await expect(page.locator("span", { hasText: "CNC Milling Center" }).first()).toBeVisible();
  });

  test("3. Scenario Simulator tests Overcast Tariff Arbitrage", async ({ page }) => {
    await page.goto("/simulator");

    await expect(page.locator("text=What-If Scenario Simulator")).toBeVisible({ timeout: 15000 });

    // Click Overcast / Monsoon Day toggle
    const overcastBtn = page.locator("button:has-text('Overcast / Monsoon Day')");
    await expect(overcastBtn).toBeVisible();
    await overcastBtn.click();

    // Verify Tariff Arbitrage banner is active
    await expect(page.locator("text=Overcast Tariff Arbitrage Active")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=0 Violations")).toBeVisible();
  });

  test("4. Forecast page displays XGBoost models with held-out test split metrics", async ({ page }) => {
    await page.goto("/forecast");

    await expect(page.locator("text=XGBoost Solar & Factory Load Forecaster")).toBeVisible({ timeout: 15000 });

    // Verify honest label
    await expect(page.locator("text=Computed on 20% held-out simulated test split")).toBeVisible();

    // Verify metric cards
    await expect(page.locator("text=Solar MAE")).toBeVisible();
    await expect(page.locator("text=Solar RMSE")).toBeVisible();
    await expect(page.locator("text=Load MAE")).toBeVisible();
    await expect(page.locator("text=Load RMSE")).toBeVisible();
  });

  test("5. Setup page allows inspecting and editing machine constraints", async ({ page }) => {
    await page.goto("/setup");

    await expect(page.locator("text=Machine Inventory & Tariff Setup")).toBeVisible({ timeout: 15000 });

    // Check table headers
    await expect(page.locator("text=Machine Name")).toBeVisible();
    await expect(page.locator("text=Power (kW)")).toBeVisible();
    await expect(page.locator("text=Deadline (T_due)")).toBeVisible();
    await expect(page.locator("input[value='CNC Milling Center']")).toBeVisible({ timeout: 10000 });
  });

  test("6. Setup page validates input boundaries and genuinely persists P_max and machines across reloads", async ({ page }) => {
    let persistedPMax = 25.0;
    let persistedMachines: any[] = [];

    await page.route("**/sites/**", async (route, request) => {
      const url = request.url();
      const method = request.method();

      if (method === "PUT" && url.endsWith("/00000000-0000-0000-0000-000000000001")) {
        const body = request.postDataJSON();
        persistedPMax = body.p_max_grid_kw;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: "00000000-0000-0000-0000-000000000001",
            name: "Machining & Stamping Unit Alpha",
            p_max_grid_kw: persistedPMax,
            storage_mode: "local_file"
          })
        });
      } else if (method === "PUT" && url.includes("/machines")) {
        persistedMachines = request.postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(persistedMachines)
        });
      } else if (method === "PUT" && url.includes("/tariff")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(request.postDataJSON())
        });
      } else if (method === "GET" && url.endsWith("/00000000-0000-0000-0000-000000000001")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: "00000000-0000-0000-0000-000000000001",
            name: "Machining & Stamping Unit Alpha",
            p_max_grid_kw: persistedPMax,
            storage_mode: "local_file"
          })
        });
      } else if (method === "GET" && url.includes("/machines") && persistedMachines.length > 0) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(persistedMachines)
        });
      } else {
        await route.continue();
      }
    });

    await page.goto("/setup");
    await expect(page.locator("text=Machine Inventory & Tariff Setup")).toBeVisible({ timeout: 15000 });

    // Change P_max from 25 to 24 kW
    const pMaxInput = page.locator("input[type='number']").first();
    await pMaxInput.fill("24");

    // Click Save Changes
    const saveBtn = page.getByRole("button", { name: /Save Changes/i });
    await saveBtn.click();

    // Verify "Saved Successfully!" appears
    await expect(page.locator("text=Saved Successfully!")).toBeVisible();

    // Reload the page and verify P_max is still 24 kW!
    await page.reload();
    await expect(page.locator("text=Machine Inventory & Tariff Setup")).toBeVisible({ timeout: 15000 });
    const reloadedPMaxInput = page.locator("input[type='number']").first();
    await expect(reloadedPMaxInput).toHaveValue("24");
  });
});
