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
    await expect(page.locator("text=Daily Electricity Cost").first()).toBeVisible();
    await expect(page.locator("text=Peak Grid Demand").first()).toBeVisible();
    await expect(page.locator("span", { hasText: "Solar Consumed On-Site" }).first()).toBeVisible();
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

  test("6. Setup page genuinely persists P_max and machines against real FastAPI backend", async ({ page }) => {
    // REAL API stack test (no page.route mocking)
    await page.goto("/setup");
    await expect(page.locator("text=Machine Inventory & Tariff Setup")).toBeVisible({ timeout: 15000 });

    // Change P_max from 25 to 24 kW
    const pMaxInput = page.locator("input[type='number']").first();
    await pMaxInput.fill("24");

    // Click Save Changes
    const saveBtn = page.getByRole("button", { name: /Save Changes/i });
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();

    // Verify Save success
    await expect(page.locator("text=Saved Successfully!")).toBeVisible({ timeout: 10000 });

    // Reload page from live server
    await page.reload();
    await expect(page.locator("text=Machine Inventory & Tariff Setup")).toBeVisible({ timeout: 15000 });
    const reloadedPMaxInput = page.locator("input[type='number']").first();
    await expect(reloadedPMaxInput).toHaveValue("24");

    // Clean up / restore to 25.0 kW
    await reloadedPMaxInput.fill("25");
    const restoreBtn = page.getByRole("button", { name: /Save Changes/i });
    await restoreBtn.click();
    await expect(page.locator("text=Saved Successfully!")).toBeVisible({ timeout: 10000 });
  });

  test("7. Setup page handles 409 conflict, shows 'Reload Latest' banner, and keeps user edits", async ({ page }) => {
    await page.goto("/setup");
    await expect(page.locator("text=Machine Inventory & Tariff Setup")).toBeVisible({ timeout: 15000 });

    // Intercept config save to simulate concurrent 409 conflict
    await page.route("**/sites/**/config", async (route) => {
      if (route.request().method() === "PUT") {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Conflict: Configuration has been modified by another session." })
        });
      } else {
        await route.continue();
      }
    });

    const pMaxInput = page.locator("input[type='number']").first();
    await pMaxInput.fill("21");

    const saveBtn = page.getByRole("button", { name: /Save Changes/i });
    await saveBtn.click();

    // Verify conflict banner appears
    await expect(page.locator("text=Conflict: Configuration has been modified")).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: "Reload Latest" })).toBeVisible();

    // Assert "Saved Successfully!" was NOT displayed
    await expect(page.locator("text=Saved Successfully!")).not.toBeVisible();

    // Assert user's typed value was preserved in the form
    await expect(pMaxInput).toHaveValue("21");
  });

  test("8. Setup page handles 500 server failure without false success, preserving user edits", async ({ page }) => {
    await page.goto("/setup");
    await expect(page.locator("text=Machine Inventory & Tariff Setup")).toBeVisible({ timeout: 15000 });

    await page.route("**/sites/**/config", async (route) => {
      if (route.request().method() === "PUT") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Internal database write error" })
        });
      } else {
        await route.continue();
      }
    });

    const pMaxInput = page.locator("input[type='number']").first();
    await pMaxInput.fill("19");

    const saveBtn = page.getByRole("button", { name: /Save Changes/i });
    await saveBtn.click();

    // Assert error is displayed
    await expect(page.locator("text=Internal database write error")).toBeVisible({ timeout: 5000 });

    // Assert "Saved Successfully!" was NOT displayed
    await expect(page.locator("text=Saved Successfully!")).not.toBeVisible();

    // Assert user's input was preserved
    await expect(pMaxInput).toHaveValue("19");
  });

  test("9. Setup page client-side validation shows inline error and dispatches no network request", async ({ page }) => {
    await page.goto("/setup");
    await expect(page.locator("text=Machine Inventory & Tariff Setup")).toBeVisible({ timeout: 15000 });

    let requestFired = false;
    page.on("request", (req) => {
      if (req.url().includes("/config") && req.method() === "PUT") {
        requestFired = true;
      }
    });

    const pMaxInput = page.locator("input[type='number']").first();
    await pMaxInput.fill("-10"); // Invalid negative P_max

    const saveBtn = page.getByRole("button", { name: /Save Changes/i });
    await saveBtn.click();

    // Verify inline validation error is displayed
    await expect(page.locator("text=Factory peak grid limit (P_max) must be a positive number")).toBeVisible({ timeout: 5000 });
    // Assert no PUT network request was dispatched
    expect(requestFired).toBe(false);
  });

  test("10. Setup page machine deletion and tariff update persist through live reload", async ({ page }) => {
    await page.goto("/setup");
    await expect(page.locator("text=Machine Inventory & Tariff Setup")).toBeVisible({ timeout: 15000 });

    // Initial count of machine rows
    const deleteButtons = page.locator("button[title='Delete machine']");
    const initialCount = await deleteButtons.count();
    expect(initialCount).toBe(7);

    // Delete last machine
    await deleteButtons.last().click();
    await expect(deleteButtons).toHaveCount(initialCount - 1);

    // Edit tariff demand charge
    const demandChargeInput = page.locator("input[type='number']").nth(1);
    await demandChargeInput.fill("26.5");

    // Click save
    const saveBtn = page.getByRole("button", { name: /Save Changes/i });
    await saveBtn.click();
    await expect(page.locator("text=Saved Successfully!")).toBeVisible({ timeout: 10000 });

    // Live reload from real server
    await page.reload();
    await expect(page.locator("text=Machine Inventory & Tariff Setup")).toBeVisible({ timeout: 15000 });

    // Assert machine remained deleted and tariff remained 26.5
    const reloadedDeleteButtons = page.locator("button[title='Delete machine']");
    await expect(reloadedDeleteButtons).toHaveCount(initialCount - 1);
    const reloadedDemandInput = page.locator("input[type='number']").nth(1);
    await expect(reloadedDemandInput).toHaveValue("26.5");

    // Clean up: Add a machine back and restore 20.0
    await page.getByRole("button", { name: "Add Machine" }).click();
    await reloadedDemandInput.fill("20.0");
    const restoreBtn = page.getByRole("button", { name: /Save Changes/i });
    await restoreBtn.click();
    await expect(page.locator("text=Saved Successfully!")).toBeVisible({ timeout: 10000 });
  });

  test("11. Scenario Simulator scenario toggle updates request payload and dispatch results", async ({ page }) => {
    await page.goto("/simulator");
    await expect(page.locator("text=What-If Scenario Simulator")).toBeVisible({ timeout: 15000 });

    // Monitor POST /scenarios/simulate calls
    let lastScenarioRequested = "";
    page.on("request", (req) => {
      if (req.url().includes("/scenarios/simulate") && req.method() === "POST") {
        try {
          const body = JSON.parse(req.postData() || "{}");
          lastScenarioRequested = body.scenario;
        } catch {}
      }
    });

    // Switch to Sunny first (initial state is overcast)
    const sunnyBtn = page.locator("button:has-text('1. Clear Sunny Day')");
    await sunnyBtn.click();
    await expect(page.locator("text=Overcast Tariff Arbitrage Active")).not.toBeVisible();
    expect(lastScenarioRequested).toBe("sunny");

    // Switch to Overcast
    const overcastBtn = page.locator("button:has-text('3. Overcast / Monsoon Day')");
    await overcastBtn.click();
    await expect(page.locator("text=Overcast Tariff Arbitrage Active")).toBeVisible({ timeout: 10000 });
    expect(lastScenarioRequested).toBe("overcast");
  });

  test("12. Forecast page handles 500 error state with retry and displays loading state", async ({ page }) => {
    // Intercept backend forecast API with 500 error using exact predicate
    const isForecastApi = (url: URL) => url.pathname === "/forecast" && url.port === "8000";

    await page.route(isForecastApi, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Forecast service temporarily unavailable." })
      });
    });

    await page.goto("/forecast");
    await expect(page.locator("text=Forecast service temporarily unavailable.")).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();

    // Unroute to test live loading and recovery
    await page.unroute(isForecastApi);
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.locator("text=Computed on 20% held-out simulated test split")).toBeVisible({ timeout: 10000 });
  });

  test("13. Setup page displays 422 field-level error messages next to invalid inputs", async ({ page }) => {
    await page.goto("/setup");
    await expect(page.locator("text=Machine Inventory & Tariff Setup")).toBeVisible({ timeout: 15000 });

    // Intercept PUT config with 422 structured field errors
    await page.route("**/sites/**/config", async (route) => {
      if (route.request().method() === "PUT") {
        await route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({
            detail: {
              message: "Configuration validation failed.",
              errors: {
                p_max_grid_kw: "P_max must be >= 0.1 kW",
                "machines[0].power_kw": "Power must be positive (> 0)"
              }
            }
          })
        });
      } else {
        await route.continue();
      }
    });

    const pMaxInput = page.locator("input[type='number']").first();
    await pMaxInput.fill("22");

    const saveBtn = page.getByRole("button", { name: /Save Changes/i });
    await saveBtn.click();

    // Verify field-level error messages appear next to the right inputs
    await expect(page.locator("text=P_max must be >= 0.1 kW")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=Power must be positive (> 0)")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=Saved Successfully!")).not.toBeVisible();
  });

  test("14. Dashboard CSV export downloads valid file with unit-labelled headers", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator("text=Industrial Scheduling Dashboard")).toBeVisible({ timeout: 15000 });

    // Wait for download event
    const downloadPromise = page.waitForEvent("download");
    const downloadBtn = page.getByRole("button", { name: /Download Schedule \(CSV\)/i });
    await downloadBtn.click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain(".csv");

    // Read download stream content
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    const csvContent = Buffer.concat(chunks).toString("utf-8");

    // Validate unit-labelled headers
    expect(csvContent).toContain("Machine Name");
    expect(csvContent).toContain("Power (kW)");
    expect(csvContent).toContain("Duration (Hours)");
    expect(csvContent).toContain("Energy (kWh)");

    // Validate machine data rows
    expect(csvContent).toContain("CNC Milling Center");
  });

  test("15. Run History lists past solver runs and reopens historical replay in Dashboard", async ({ page }) => {
    // 1. Visit History page
    await page.goto("/history");
    await expect(page.locator("text=Optimization Run History")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("text=Logged Solver Runs")).toBeVisible({ timeout: 10000 });

    // 2. Verify runs are listed with verifier status
    await expect(page.locator("text=PASS").first()).toBeVisible({ timeout: 5000 });

    // 3. Click Reopen button on the first historical run
    const reopenBtn = page.getByRole("button", { name: /Reopen/i }).first();
    await expect(reopenBtn).toBeVisible();
    await reopenBtn.click();

    // 4. Verify redirected to dashboard in replay mode
    await expect(page).toHaveURL(/.*dashboard\?reopened=true.*/);
    await expect(page.locator("text=Viewing Historical Replay")).toBeVisible({ timeout: 10000 });

    // 5. Exit replay mode
    const exitBtn = page.getByRole("button", { name: /Exit Replay & Run Live Optimization/i });
    await expect(exitBtn).toBeVisible();
    await exitBtn.click();

    // Verify replay banner exits and returns to live mode
    await expect(page.locator("text=Viewing Historical Replay")).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=Live MILP Optimal")).toBeVisible();
  });

  test("16. Tariff editor edits Time-of-Day slabs, updates 96-interval preview chart, validates 24-hr continuity, and persists atomically", async ({ page }) => {
    await page.goto("/setup");
    await expect(page.locator("text=Machine Inventory & Tariff Setup")).toBeVisible({ timeout: 15000 });

    // 1. Verify Tariff Editor and 96-interval preview chart are rendered
    await expect(page.locator("text=Time-of-Day (ToD) Tariff Slabs & Demand Charge")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=96-Interval Tariff Profile Preview")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=Full 24-hour continuous coverage verified")).toBeVisible({ timeout: 5000 });

    // 2. Locate the first slab row in the Tariff table
    const tariffTable = page.locator("table").last();
    const firstRow = tariffTable.locator("tbody tr").first();
    const endTimeInput = firstRow.locator("input").nth(2); // 0=name, 1=start, 2=end, 3=rate
    const rateInput = firstRow.locator("input").nth(3);

    // 3. Trigger validation gap error by editing the first slab's end time
    await endTimeInput.fill("05:00");
    await expect(page.locator("text=Gap detected")).toBeVisible({ timeout: 5000 });

    // 4. Restore valid end time
    await endTimeInput.fill("06:00");
    await expect(page.locator("text=Full 24-hour continuous coverage verified")).toBeVisible({ timeout: 5000 });

    // 5. Update the energy rate of the first slab
    await rateInput.fill("5.2");

    // 6. Save Configuration atomically
    const saveBtn = page.getByRole("button", { name: /Save Changes/i });
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });
    await saveBtn.click();
    await expect(page.locator("text=Saved Successfully!")).toBeVisible({ timeout: 10000 });

    // 7. Reload page from live backend and verify persisted slab rate
    await page.reload();
    await expect(page.locator("text=Machine Inventory & Tariff Setup")).toBeVisible({ timeout: 15000 });
    const reloadedTariffTable = page.locator("table").last();
    const reloadedRateInput = reloadedTariffTable.locator("tbody tr").first().locator("input").nth(3);
    await expect(reloadedRateInput).toHaveValue("5.2");
  });

  test("17. Bill Reality Check compares real monthly bill with scaled baseline estimate and displays likely causes with disclaimer", async ({ page }) => {
    await page.goto("/bill-check");
    await expect(page.locator("text=Utility Bill Reality Check")).toBeVisible({ timeout: 15000 });

    // 1. Verify prominent Sanity Check Disclaimer
    await expect(page.locator("text=Sanity Check Disclaimer — Not Formal Validation")).toBeVisible({ timeout: 5000 });

    // 2. Click Load Sample BESCOM Bill
    const sampleBtn = page.getByRole("button", { name: /Load Sample BESCOM Bill/i });
    await expect(sampleBtn).toBeVisible();
    await sampleBtn.click();

    // 3. Trigger Reality Sanity Check calculation
    const runBtn = page.getByRole("button", { name: /Run Reality Sanity Check/i });
    await expect(runBtn).toBeVisible();
    await runBtn.click();

    // 4. Verify comparison metric cards and alignment badge
    await expect(page.locator("text=Total Monthly Bill").first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=Billed Grid Energy").first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=Peak Recorded Demand").first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=Observed Gaps & Probable Causes")).toBeVisible({ timeout: 5000 });
  });

  test("18. What-If Simulator edits machine windows, deadlines, and grid limit without saving, and re-runs live simulation", async ({ page }) => {
    await page.goto("/simulator");
    await expect(page.locator("text=What-If Scenario Simulator")).toBeVisible({ timeout: 15000 });

    // 1. Verify What-If Parameters Sandbox is rendered
    await expect(page.locator("text=What-If Parameters Sandbox")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=Unsaved / Ephemeral")).toBeVisible({ timeout: 5000 });

    // 2. Edit transient grid limit in simulator
    const gridLimitInput = page.locator("input[value='25']").first();
    await expect(gridLimitInput).toBeVisible();
    await gridLimitInput.fill("18");

    // 3. Edit transient deadline of first machine
    const firstDeadlineInput = page.locator("input[value='68']").first();
    await expect(firstDeadlineInput).toBeVisible();
    await firstDeadlineInput.fill("72");

    // 4. Run What-If Solver
    const runSolverBtn = page.getByRole("button", { name: /Run What-If Solver/i });
    await expect(runSolverBtn).toBeVisible();
    await runSolverBtn.click();

    // Verify simulation recalculates and displays KPIs and charts
    await expect(page.locator("text=Daily Electricity Cost").first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=Peak Grid Demand").first()).toBeVisible({ timeout: 5000 });

    // 5. Navigate to Machine Setup to prove transient edits were NOT persisted
    await page.goto("/setup");
    await expect(page.locator("text=Machine Inventory & Tariff Setup")).toBeVisible({ timeout: 15000 });

    // Machine setup should NOT have the simulator's transient 18 kW value
    const setupGridLimit = page.locator("input[value='18']");
    await expect(setupGridLimit).toHaveCount(0);
  });

  test("19. Developer experience regression: all 7 pages load real data without console errors, network failures, or 'Failed to fetch'", async ({ page }) => {
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    page.on("pageerror", (err) => {
      consoleErrors.push(err.message);
    });

    page.on("requestfailed", (req) => {
      failedRequests.push(`${req.method()} ${req.url()} - ${req.failure()?.errorText}`);
    });

    const routesToTest = [
      {
        path: "/",
        assertContent: async () => {
          await expect(page.locator("h1")).toContainText("Machine Scheduling");
          await expect(page.locator("text=Simulated Decision Support")).toBeVisible();
        }
      },
      {
        path: "/dashboard",
        assertContent: async () => {
          await expect(page.locator("text=Daily Electricity Cost").first()).toBeVisible({ timeout: 15000 });
          await expect(page.locator("text=Peak Grid Demand").first()).toBeVisible();
          await expect(page.locator("text=VERIFIED STRICT")).toBeVisible();
          await expect(page.locator("text=0 Violations")).toBeVisible();
          // Ensure real numeric values are rendered (₹ and numeric digits)
          const bodyText = await page.innerText("body");
          expect(bodyText).toContain("₹");
          expect(bodyText).toMatch(/₹\s*[0-9]+(\.[0-9]+)?/);
          expect(bodyText).toMatch(/[0-9]+(\.[0-9]+)?\s*kW/);
          // Assert Plotly chart traces are rendered and non-empty
          await expect(page.locator(".js-plotly-plot").first()).toBeVisible({ timeout: 15000 });
          const traces = page.locator(".js-plotly-plot svg.main-svg g.trace");
          expect(await traces.count()).toBeGreaterThan(0);
        }
      },
      {
        path: "/history",
        assertContent: async () => {
          await expect(page.locator("text=Optimization Run History")).toBeVisible({ timeout: 15000 });
          await expect(page.locator("text=Logged Solver Runs")).toBeVisible();
          // Verify history table has at least one real entry with numeric values
          await expect(page.locator("table")).toBeVisible();
          const rows = page.locator("table tbody tr");
          expect(await rows.count()).toBeGreaterThan(0);
          const tableText = await page.locator("table").innerText();
          expect(tableText).toContain("₹");
          expect(tableText).toMatch(/[0-9]+(\.[0-9]+)?\s*kW/);
        }
      },
      {
        path: "/bill-check",
        assertContent: async () => {
          await expect(page.locator("text=Utility Bill Reality Check")).toBeVisible({ timeout: 15000 });
          await expect(page.locator("text=Total Monthly Bill").first()).toBeVisible();
          await expect(page.locator("text=Observed Gaps & Probable Causes")).toBeVisible();
          // Verify form fields and initial sanity calculations contain numeric metrics
          const bodyText = await page.innerText("body");
          expect(bodyText).toMatch(/₹\s*[0-9,]+/);
        }
      },
      {
        path: "/simulator",
        assertContent: async () => {
          await expect(page.locator("text=What-If Scenario Simulator")).toBeVisible({ timeout: 15000 });
          await expect(page.locator("text=What-If Parameters Sandbox")).toBeVisible();
          await expect(page.locator("text=CNC Milling Center").first()).toBeVisible();
          // Verify sandbox table contains machines with numeric kW and intervals
          const tableText = await page.locator("table").innerText();
          expect(tableText).toMatch(/[0-9]+(\.[0-9]+)?\s*kW/);
        }
      },
      {
        path: "/setup",
        assertContent: async () => {
          await expect(page.locator("text=Machine Inventory & Tariff Setup")).toBeVisible({ timeout: 15000 });
          await expect(page.locator("input[value='CNC Milling Center']")).toBeVisible();
          await expect(page.locator("text=Time-of-Day (ToD) Tariff Slabs")).toBeVisible();
          // Verify numeric grid limit input is present and non-empty
          const gridInput = page.locator("input#p_max_grid_kw, input[type='number']").first();
          await expect(gridInput).toBeVisible();
          const val = await gridInput.inputValue();
          expect(parseFloat(val)).toBeGreaterThan(0);
        }
      },
      {
        path: "/forecast",
        assertContent: async () => {
          await expect(page.locator("text=XGBoost Solar & Factory Load Forecaster")).toBeVisible({ timeout: 15000 });
          await expect(page.locator("text=Solar MAE")).toBeVisible();
          await expect(page.locator("text=Solar RMSE")).toBeVisible();
          // Assert real numbers in metric cards
          await expect(page.locator("text=0.054")).toBeVisible();
          await expect(page.locator("text=0.095")).toBeVisible();
          // Assert 96-interval forecast chart traces are rendered and non-empty
          await expect(page.locator(".js-plotly-plot").first()).toBeVisible({ timeout: 15000 });
          const traces = page.locator(".js-plotly-plot svg.main-svg g.trace");
          expect(await traces.count()).toBeGreaterThan(0);
          // Assert 96-interval forecast text present
          const bodyText = await page.innerText("body");
          expect(bodyText).toContain("96-Interval XGBoost Industrial Solar & Load Forecast");
        }
      }
    ];

    for (const r of routesToTest) {
      consoleErrors.length = 0;
      failedRequests.length = 0;

      await page.goto(r.path, { waitUntil: "networkidle", timeout: 15000 });
      await page.waitForTimeout(500);

      // 1. Assert no "Failed to fetch" text anywhere in DOM
      const bodyText = await page.innerText("body");
      expect(bodyText).not.toContain("Failed to fetch");
      expect(bodyText).not.toContain("net::ERR_CONNECTION_REFUSED");

      // 2. Assert real data rendered
      await r.assertContent();

      // 3. Assert zero console errors & zero failed network requests
      expect(consoleErrors, `Console errors detected on ${r.path}: ${consoleErrors.join("; ")}`).toHaveLength(0);
      expect(failedRequests, `Failed network requests detected on ${r.path}: ${failedRequests.join("; ")}`).toHaveLength(0);
    }
  });
});
