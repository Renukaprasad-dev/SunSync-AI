import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendDir = path.resolve(__dirname, "../../backend");

// 1. Locate Python executable cross-platform
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

// 2. Check if port is already in use
function checkPortInUse(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(800);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      resolve(false);
    });
    socket.connect(port, "127.0.0.1");
  });
}

async function main() {
  const inUse = await checkPortInUse(8000);
  if (inUse) {
    const msg = "ERROR: Port 8000 is already in use. A stale backend process may be running. Please stop it before running Playwright tests.";
    console.error(`\x1b[31m${msg}\x1b[0m`);
    process.exit(1);
  }

  const pythonExec = findPython();
  const tempStore = path.join(os.tmpdir(), "sunsync_playwright_store.json");
  if (fs.existsSync(tempStore)) {
    try {
      fs.unlinkSync(tempStore);
    } catch (e) {
      // Ignore if unlinking fails
    }
  }

  console.log(`[SunSync Playwright Starter] Launching FastAPI backend using: ${pythonExec}`);
  console.log(`[SunSync Playwright Starter] Isolated temporary store: ${tempStore}`);

  const env = {
    ...process.env,
    PYTHONPATH: backendDir,
    STORAGE_MODE: "local_file",
    LOCAL_STORE_PATH: tempStore,
    SUPABASE_URL: "",
    SUPABASE_SERVICE_ROLE_KEY: ""
  };

  const child = spawn(
    pythonExec,
    ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
    {
      cwd: backendDir,
      env,
      stdio: "inherit"
    }
  );

  const cleanExit = () => {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  };

  process.on("SIGINT", cleanExit);
  process.on("SIGTERM", cleanExit);
  process.on("exit", cleanExit);

  child.on("exit", (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error(`FastAPI backend exited with code ${code}`);
      process.exit(code);
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
