import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { createErrorResult, type ComputerUseToolResult } from "./contract.js";
import type {
  ClickParams,
  ComputerUseBackend,
  DragParams,
  GetAppStateParams,
  ListAppsParams,
  PerformSecondaryActionParams,
  PressKeyParams,
  ScrollParams,
  SetValueParams,
  TypeTextParams,
} from "./backend.js";
import type { HelperRequest, HelperResponse, HelperMethod } from "./helper-protocol.js";

const execFileAsync = promisify(execFile);
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(moduleDir, "..");
const helperSourceDir = path.join(packageRoot, "helper");

function helperCachePath(): string {
  return process.env.MAC_USE_CACHE_DIR ?? path.join(os.homedir(), "Library", "Caches", "mac-use");
}

export class NativeHelperBackend implements ComputerUseBackend {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<
    string,
    {
      resolve: (result: ComputerUseToolResult) => void;
      reject: (error: Error) => void;
    }
  >();
  private nextId = 0;
  private helperReady: Promise<string> | null = null;

  async listApps(_params: ListAppsParams): Promise<ComputerUseToolResult> {
    return this.send("list_apps", {});
  }

  async getAppState(params: GetAppStateParams): Promise<ComputerUseToolResult> {
    return this.send("get_app_state", params as unknown as Record<string, unknown>);
  }

  async click(_params: ClickParams): Promise<ComputerUseToolResult> {
    return this.send("click", _params as unknown as Record<string, unknown>);
  }

  async drag(_params: DragParams): Promise<ComputerUseToolResult> {
    return this.send("drag", _params as unknown as Record<string, unknown>);
  }

  async typeText(_params: TypeTextParams): Promise<ComputerUseToolResult> {
    return this.send("type_text", _params as unknown as Record<string, unknown>);
  }

  async pressKey(_params: PressKeyParams): Promise<ComputerUseToolResult> {
    return this.send("press_key", _params as unknown as Record<string, unknown>);
  }

  async setValue(_params: SetValueParams): Promise<ComputerUseToolResult> {
    return this.send("set_value", _params as unknown as Record<string, unknown>);
  }

  async scroll(_params: ScrollParams): Promise<ComputerUseToolResult> {
    return this.send("scroll", _params as unknown as Record<string, unknown>);
  }

  async performSecondaryAction(_params: PerformSecondaryActionParams): Promise<ComputerUseToolResult> {
    return this.send("perform_secondary_action", _params as unknown as Record<string, unknown>);
  }

  close(): void {
    if (!this.child) {
      return;
    }
    this.child.kill();
    this.child = null;
  }

  private async send(method: HelperMethod, params: Record<string, unknown>): Promise<ComputerUseToolResult> {
    await this.ensureHelperBinary();
    const child = this.ensureChild();
    const id = `req_${++this.nextId}`;
    const request: HelperRequest = { id, method, params };

    const result = await new Promise<ComputerUseToolResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify(request)}\n`);
    });

    return result;
  }

  private ensureChild(): ChildProcessWithoutNullStreams {
    if (this.child) {
      return this.child;
    }

    const cachePath = helperCachePath();
    const helperBinary = path.join(cachePath, "ComputerUseNativeHelper");
    const child = spawn(helperBinary, [], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    const stdout = readline.createInterface({ input: child.stdout });
    stdout.on("line", (line) => {
      if (!line.trim()) {
        return;
      }

      let parsed: HelperResponse;
      try {
        parsed = JSON.parse(line) as HelperResponse;
      } catch (error) {
        this.rejectAll(new Error(`Failed to parse native helper response: ${String(error)}`));
        return;
      }

      const pending = this.pending.get(parsed.id);
      if (!pending) {
        return;
      }
      this.pending.delete(parsed.id);

      if (parsed.ok && parsed.result) {
        pending.resolve(parsed.result);
        return;
      }

      pending.reject(new Error(parsed.error ?? "Native helper request failed."));
    });

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderr += text;
    });

    child.on("error", (error) => {
      this.rejectAll(error instanceof Error ? error : new Error(String(error)));
      this.child = null;
    });

    child.on("close", (code) => {
      const detail = stderr.trim().length > 0 ? ` ${stderr.trim()}` : "";
      this.rejectAll(new Error(`Native helper exited with code ${code ?? "unknown"}.${detail}`));
      this.child = null;
    });

    this.child = child;
    return child;
  }

  private async ensureHelperBinary(): Promise<string> {
    if (this.helperReady) {
      return this.helperReady;
    }

    this.helperReady = (async () => {
      const cachePath = helperCachePath();
      await fs.mkdir(cachePath, { recursive: true });
      const helperTargets = [
        {
          source: path.join(helperSourceDir, "ComputerUseNativeHelper.swift"),
          binary: path.join(cachePath, "ComputerUseNativeHelper"),
        },
        {
          source: path.join(helperSourceDir, "WindowCaptureHelper.swift"),
          binary: path.join(cachePath, "WindowCaptureHelper"),
        },
      ];

      for (const target of helperTargets) {
        const [sourceStat, binaryStat] = await Promise.all([
          fs.stat(target.source),
          fs.stat(target.binary).catch(() => null),
        ]);

        const binaryIsFresh = binaryStat && binaryStat.mtimeMs >= sourceStat.mtimeMs;
        if (!binaryIsFresh) {
          await execFileAsync("swiftc", [target.source, "-o", target.binary], {
            cwd: packageRoot,
            env: {
              ...process.env,
              CLANG_MODULE_CACHE_PATH: cachePath,
              SWIFT_MODULECACHE_PATH: cachePath,
            },
          });
        }
      }

      return path.join(cachePath, "ComputerUseNativeHelper");
    })().catch((error) => {
      this.helperReady = null;
      throw error;
    });

    return this.helperReady;
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}
