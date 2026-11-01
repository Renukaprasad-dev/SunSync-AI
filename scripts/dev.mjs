#!/usr/bin/env node
/**
 * SunSync AI - Unified Local Development Runner
 * Starts the FastAPI backend (venv-aware, cross-platform), waits for /health,
 * and starts the Next.js frontend dev server concurrently.
 * 
 * Usage:
 *   node scripts/dev.mjs
 * Or via npm:
 *   npm run dev:all
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const backendDir = path.join(rootDir, "backend");
const frontendDir = path.join(rootDir, "frontend");

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
};

function log(prefix, msg, color = colors.reset) {
  console.log(`${color}[${prefix}]${colors.reset} ${msg}`);
}

function findPython() {
  if (process.env.PYTHON && fs.existsSync(process.env.PYTHON)) {
    return process.env.PYTHON;
  }
  const isWin = process.platform === "win32";
  const venvPython = isWin
    ? path.join(backendDir, ".venv", "Scripts", "python.exe")
    : path.join(backendDir, ".venv", "bin", "python");

  if (fs.existsSync(venvPython)) {
    return venvPython;
  }
  return isWin ? "python" : "python3";
}

function checkPort(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(800);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true); // in use
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false); // free
    });
    socket.once("error", () => {
      resolve(false); // free
    });
    socket.connect(port, host);
  });
}

async function waitForHealth(maxAttempts = 30, intervalMs = 500) {
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      const res = await fetch("http://127.0.0.1:8000/health");
      if (res.ok) {
        const data = await res.json();
        return data;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

async function main() {
  console.log("\n" + colors.bold + colors.cyan + "═".repeat(60) + colors.reset);
  console.log(colors.bold + "  SunSync AI — Unified Local Development Environment" + colors.reset);
  console.log(colors.cyan + "═".repeat(60) + colors.reset + "\n");

  const pythonExec = findPython();
  log("DevRunner", `Python runtime: ${colors.green}${pythonExec}${colors.reset}`);

  // 1. Check if ports are already bound
  const port8000InUse = await checkPort(8000);
  const port3000InUse = await checkPort(3000);

  if (port8000InUse) {
    log("DevRunner", `${colors.yellow}Port 8000 is already in use. Checking if backend is alive...${colors.reset}`);
    const alive = await waitForHealth(3, 300);
    if (alive) {
      log("Backend", `Existing FastAPI instance responded healthy (${alive.storage_mode}). Reusing it.`, colors.green);
    } else {
      log("DevRunner", `${colors.red}Port 8000 in use but not responding to /health. Please stop the stale process.${colors.reset}`);
      process.exit(1);
    }
  }

  let backendProc = null;
  if (!port8000InUse) {
    log("Backend", "Starting FastAPI server on http://127.0.0.1:8000...", colors.blue);
    backendProc = spawn(
      pythonExec,
      ["-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"],
      {
        cwd: backendDir,
        env: {
          ...process.env,
          PYTHONPATH: backendDir,
          PYTHONUNBUFFERED: "1"
        },
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    backendProc.stdout.on("data", (data) => {
      const line = data.toString().trim();
      if (line) log("FastAPI", line, colors.dim);
    });

    backendProc.stderr.on("data", (data) => {
      const line = data.toString().trim();
      if (line) log("FastAPI", line, colors.yellow);
    });

    backendProc.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        log("Backend", `FastAPI exited with code ${code}`, colors.red);
      }
    });

    log("Backend", "Waiting for /health endpoint...", colors.blue);
    const health = await waitForHealth(30, 400);
    if (!health) {
      log("Backend", `${colors.red}FastAPI backend failed to start within 12 seconds.${colors.reset}`);
      if (backendProc) backendProc.kill("SIGTERM");
      process.exit(1);
    }
    log("Backend", `Connected! Storage: ${colors.bold}${health.storage_mode}${colors.reset} (Durable: ${health.durable})`, colors.green);
  }

  // 2. Start Frontend Next.js Dev Server
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  log("Frontend", "Starting Next.js 14 on http://localhost:3000...", colors.blue);

  const frontendProc = spawn(npmCmd, ["run", "dev"], {
    cwd: frontendDir,
    env: {
      ...process.env,
      NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000"
    },
    stdio: "inherit"
  });

  const cleanup = () => {
    log("DevRunner", "Shutting down servers...", colors.yellow);
    if (backendProc && !backendProc.killed) {
      backendProc.kill("SIGTERM");
    }
    if (frontendProc && !frontendProc.killed) {
      frontendProc.kill("SIGTERM");
    }
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("exit", cleanup);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
