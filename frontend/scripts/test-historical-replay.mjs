/**
 * Unit test suite for historical replay validation (isOptimizationResponse)
 */
import assert from "node:assert";

console.log("=== Running Historical Replay Validation Tests ===");

// Implementation matching frontend/src/app/dashboard/page.tsx
const isOptimizationResponse = (value) => {
  if (!value || typeof value !== "object") return false;
  const response = value;
  if (!response.strategies || typeof response.strategies !== "object") return false;

  const strategyEntries = Object.entries(response.strategies);
  if (strategyEntries.length === 0) return false;

  const supportedStrategies = new Set(["baseline", "solar_aware", "cost_optimized"]);

  return strategyEntries.every(([name, strategy]) => {
    if (!supportedStrategies.has(name) || !strategy || typeof strategy !== "object") return false;

    // KPIs validation
    if (!strategy.kpis || typeof strategy.kpis !== "object") return false;
    const kpisValid = Object.values(strategy.kpis).every((n) => n === undefined || Number.isFinite(n));
    if (!kpisValid) return false;

    // Machine schedules validation
    if (!Array.isArray(strategy.machine_schedules)) return false;

    // 96-interval profile validations
    const profiles = [
      strategy.load_profile,
      strategy.grid_profile,
      strategy.solar_profile,
      strategy.solar_used_profile
    ];
    return profiles.every((profile) =>
      Array.isArray(profile) &&
      profile.length === 96 &&
      profile.every((n) => Number.isFinite(n))
    );
  });
};

const makeMockStrategy = (name) => ({
  strategy_name: name,
  display_title: name.toUpperCase(),
  status: "OPTIMAL",
  solver_duration_ms: 50,
  machine_schedules: [],
  load_profile: new Array(96).fill(5.0),
  grid_profile: new Array(96).fill(3.0),
  solar_profile: new Array(96).fill(2.0),
  solar_used_profile: new Array(96).fill(2.0),
  kpis: {
    daily_cost_rs: 500.0,
    peak_grid_demand_kw: 15.0,
    solar_energy_used_kwh: 40.0,
    grid_energy_imported_kwh: 100.0,
    solar_self_consumption_pct: 85.0,
    deadline_violations: 0,
  },
});

// Test 1: All three strategies
{
  const res = {
    strategies: {
      baseline: makeMockStrategy("baseline"),
      solar_aware: makeMockStrategy("solar_aware"),
      cost_optimized: makeMockStrategy("cost_optimized"),
    },
  };
  assert.strictEqual(isOptimizationResponse(res), true, "All three strategies must be valid");
  console.log("  [PASS] Test 1: All three strategies validated successfully");
}

// Test 2: Baseline + cost-optimized only (Simulator shape)
{
  const res = {
    strategies: {
      baseline: makeMockStrategy("baseline"),
      cost_optimized: makeMockStrategy("cost_optimized"),
    },
  };
  assert.strictEqual(isOptimizationResponse(res), true, "Baseline + cost_optimized must be valid");
  console.log("  [PASS] Test 2: Baseline + cost_optimized only validated successfully");
}

// Test 3: Cost-optimized only
{
  const res = {
    strategies: {
      cost_optimized: makeMockStrategy("cost_optimized"),
    },
  };
  assert.strictEqual(isOptimizationResponse(res), true, "Cost-optimized only must be valid");
  console.log("  [PASS] Test 3: Cost_optimized only validated successfully");
}

// Test 4: Solar-aware only
{
  const res = {
    strategies: {
      solar_aware: makeMockStrategy("solar_aware"),
    },
  };
  assert.strictEqual(isOptimizationResponse(res), true, "Solar-aware only must be valid");
  console.log("  [PASS] Test 4: Solar_aware only validated successfully");
}

// Test 5: Empty strategies ({}) must fail
{
  const res = { strategies: {} };
  assert.strictEqual(isOptimizationResponse(res), false, "Empty strategies object must be rejected");
  console.log("  [PASS] Test 5: Empty strategies dictionary rejected correctly");
}

// Test 6: Incomplete profile length (< 96 intervals) must fail
{
  const invalidStrat = makeMockStrategy("baseline");
  invalidStrat.load_profile = new Array(50).fill(1.0); // only 50 intervals
  const res = { strategies: { baseline: invalidStrat } };
  assert.strictEqual(isOptimizationResponse(res), false, "Profile with length != 96 must be rejected");
  console.log("  [PASS] Test 6: Incomplete profile length (< 96) rejected correctly");
}

// Test 7: Non-finite profile values (NaN, null, string) must fail
{
  const invalidStrat = makeMockStrategy("cost_optimized");
  invalidStrat.grid_profile[10] = NaN;
  const res = { strategies: { cost_optimized: invalidStrat } };
  assert.strictEqual(isOptimizationResponse(res), false, "Non-finite values in profiles must be rejected");
  console.log("  [PASS] Test 7: NaN/null in profiles rejected correctly");
}

// Test 8: Unsupported strategy name must fail
{
  const invalidStrat = makeMockStrategy("unsupported_strategy_name");
  const res = { strategies: { unsupported_strategy_name: invalidStrat } };
  assert.strictEqual(isOptimizationResponse(res), false, "Unsupported strategy names must be rejected");
  console.log("  [PASS] Test 8: Unsupported strategy name rejected correctly");
}

// Test 9: Null / undefined / primitive inputs
{
  assert.strictEqual(isOptimizationResponse(null), false);
  assert.strictEqual(isOptimizationResponse(undefined), false);
  assert.strictEqual(isOptimizationResponse("string"), false);
  assert.strictEqual(isOptimizationResponse(123), false);
  assert.strictEqual(isOptimizationResponse({}), false);
  console.log("  [PASS] Test 9: Malformed/primitive values rejected correctly");
}

// Test 10: Historical response without machine_reasons (omitted key)
{
  const res = {
    strategies: {
      baseline: makeMockStrategy("baseline"),
      cost_optimized: makeMockStrategy("cost_optimized"),
    },
  };
  assert.strictEqual(isOptimizationResponse(res), true, "Response without machine_reasons must be valid");
  console.log("  [PASS] Test 10: Historical response without machine_reasons validated successfully");
}

// Test 11: Historical response with machine_reasons: null
{
  const res = {
    strategies: {
      baseline: makeMockStrategy("baseline"),
      cost_optimized: makeMockStrategy("cost_optimized"),
    },
    machine_reasons: null,
  };
  assert.strictEqual(isOptimizationResponse(res), true, "Response with machine_reasons: null must be valid");
  console.log("  [PASS] Test 11: Historical response with machine_reasons: null validated successfully");
}

// Test 12: Machine reason lookup runtime safety (ReasonPanel simulation)
{
  const resolveReason = (opt, machineReasons) => {
    const safeReasons = machineReasons ?? {};
    return opt.reason || safeReasons[opt.machine_id] || machineReasons?.[opt.machine_id] || "Schedule maintained within limits.";
  };

  const mWithReason = { machine_id: "m1", reason: "Shifted to peak solar hours." };
  const mWithoutReason = { machine_id: "m2", reason: null };

  // Case A: machineReasons provided as dict
  assert.strictEqual(resolveReason(mWithReason, { m1: "Dict reason" }), "Shifted to peak solar hours.");
  assert.strictEqual(resolveReason(mWithoutReason, { m2: "Dict reason for m2" }), "Dict reason for m2");

  // Case B: machineReasons is undefined
  assert.doesNotThrow(() => {
    const r1 = resolveReason(mWithReason, undefined);
    assert.strictEqual(r1, "Shifted to peak solar hours.");
    const r2 = resolveReason(mWithoutReason, undefined);
    assert.strictEqual(r2, "Schedule maintained within limits.");
  }, "Undefined machineReasons must not throw TypeError");

  // Case C: machineReasons is null
  assert.doesNotThrow(() => {
    const r1 = resolveReason(mWithReason, null);
    assert.strictEqual(r1, "Shifted to peak solar hours.");
    const r2 = resolveReason(mWithoutReason, null);
    assert.strictEqual(r2, "Schedule maintained within limits.");
  }, "Null machineReasons must not throw TypeError");

  console.log("  [PASS] Test 12: Machine reason lookup safety verified across null, undefined, and valid dicts");
}

console.log("=== All Historical Replay Validation Tests Passed ===\n");
