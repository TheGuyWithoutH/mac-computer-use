#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const binDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(binDir, "..");
const sourceCliPath = path.resolve(projectRoot, "src/cli.ts");
const tsxEntryPath = path.resolve(projectRoot, "node_modules/tsx/dist/loader.mjs");
const distCliPath = path.resolve(projectRoot, "dist/cli.js");

if (existsSync(sourceCliPath) && existsSync(tsxEntryPath)) {
  const child = spawn(process.execPath, ["--import", tsxEntryPath, sourceCliPath, ...process.argv.slice(2)], {
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
} else if (existsSync(distCliPath)) {
  await import(pathToFileURL(distCliPath).href);
} else {
  console.error("Unable to find src/cli.ts with local tsx or built dist/cli.js.");
  console.error("Run npm install for development mode, or npm run build for package mode.");
  process.exit(1);
}
