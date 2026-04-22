#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const binDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(binDir, "..");
const serverPath = path.resolve(projectRoot, "src/server.ts");
const tsxEntry = path.resolve(projectRoot, "node_modules/tsx/dist/loader.mjs");

const child = spawn(process.execPath, ["--import", tsxEntry, serverPath], {
  stdio: "inherit",
  cwd: projectRoot,
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
