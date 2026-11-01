#!/usr/bin/env node
/**
 * SunSync AI - Diagnostic Health & Environment Doctor Tool (Node Runner)
 * Invokes python scripts/doctor.py using the platform-appropriate Python interpreter.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const backendDir = path.join(rootDir, "backend");

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

const pyExec = findPython();
const doctorPy = path.join(__dirname, "doctor.py");

const child = spawn(pyExec, [doctorPy], {
  cwd: rootDir,
  stdio: "inherit"
});

child.on("exit", (code) => {
  process.exit(code || 0);
});
