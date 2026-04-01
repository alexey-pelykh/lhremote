// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { type ChildProcess, spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { join } from "node:path";

import getPort from "get-port";

import { discoverTargets, findApp } from "../cdp/index.js";
import { AppLaunchError, AppNotFoundError, LinkedHelperUnreachableError } from "./errors.js";

/** Default delay after spawn before checking if the app is reachable (ms). */
const DEFAULT_LAUNCH_PROBE_DELAY = 3000;

/** Maximum time to wait for the process to exit after SIGTERM (ms). */
const QUIT_GRACEFUL_TIMEOUT = 10_000;

/** Maximum time to wait for the process to exit after SIGKILL (ms). */
const QUIT_FORCE_TIMEOUT = 5_000;

export interface AppServiceOptions {
  /** Delay in ms after spawn before checking if the app is reachable (default 3000). */
  launchProbeDelay?: number;
  /** Kill existing LinkedHelper processes before launching (default false). */
  force?: boolean;
}

/**
 * Manages the LinkedHelper application process lifecycle.
 *
 * Provides methods to launch, quit, and probe the LinkedHelper
 * Electron application.  When no explicit CDP port is provided,
 * a free port is selected automatically at launch time.
 */
export class AppService {
  private assignedPort: number | null;
  private childProcess: ChildProcess | null = null;
  private detectedExternal = false;
  private readonly launchProbeDelay: number;
  private readonly force: boolean;

  /**
   * @param cdpPort - Explicit CDP port.  When omitted, `launch()` will
   *   select a free port automatically via `get-port`.
   * @param options - Additional configuration options.
   */
  constructor(cdpPort?: number, options?: AppServiceOptions) {
    this.assignedPort = cdpPort ?? null;
    this.launchProbeDelay = options?.launchProbeDelay ?? DEFAULT_LAUNCH_PROBE_DELAY;
    this.force = options?.force ?? false;
  }

  /**
   * The CDP port currently in use.
   *
   * @throws {Error} if neither an explicit port was provided nor
   *   `launch()` has been called yet.
   */
  get cdpPort(): number {
    if (this.assignedPort === null) {
      throw new Error("CDP port not yet assigned — call launch() first or provide a port to the constructor");
    }
    return this.assignedPort;
  }

  /**
   * Launch the LinkedHelper application with CDP enabled.
   *
   * If no CDP port was specified in the constructor, a free port
   * is selected automatically.
   *
   * @throws {AppNotFoundError} if the binary cannot be found.
   * @throws {AppLaunchError} if the process fails to start.
   */
  async launch(): Promise<void> {
    if (this.assignedPort !== null && !this.force && await this.isRunning()) {
      return;
    }

    // Proactive conflict detection: check for existing LH processes
    const existingApps = await findApp();
    if (existingApps.length > 0) {
      if (!this.force) {
        // Only reuse a launcher process — connecting to an instance port
        // as a launcher yields WrongPortError because the instance lacks
        // the electronStore / mainWindow globals.
        const connectableLauncher = existingApps.find(
          (a) => a.connectable && a.role === "launcher",
        );
        if (connectableLauncher) {
          this.assignedPort = connectableLauncher.cdpPort;
          this.detectedExternal = true;
          return;
        }
        throw new LinkedHelperUnreachableError(existingApps);
      }
      // Force mode: kill all existing processes before relaunching
      await killProcesses(existingApps.map((a) => a.pid));
    }

    if (this.assignedPort === null) {
      this.assignedPort = await getPort();
    }

    const binary = AppService.findBinary();
    const args = [`--remote-debugging-port=${String(this.assignedPort)}`];

    const child = spawn(binary, args, {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "" },
    });

    child.unref();

    // Wait for an early error (e.g. ENOENT from spawn) before probing
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        cleanup();
        reject(new AppLaunchError(`Failed to launch LinkedHelper: ${err.message}`, { cause: err }));
      };

      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, this.launchProbeDelay);

      function cleanup() {
        child.removeListener("error", onError);
        clearTimeout(timer);
      }

      child.on("error", onError);
    });

    this.childProcess = child;
  }

  /**
   * Quit the LinkedHelper application.
   *
   * When a child process handle is available, sends `SIGTERM` and waits
   * for the process to exit.  If it does not exit within
   * {@link QUIT_GRACEFUL_TIMEOUT}, escalates to `SIGKILL`.
   *
   * When the instance was detected externally (not spawned by us),
   * `quit()` is a no-op to avoid destroying the user's running app.
   *
   * When no child process handle is available and the port was
   * explicitly provided, attempts to close via CDP.
   */
  async quit(): Promise<void> {
    if (this.childProcess) {
      const child = this.childProcess;
      this.childProcess = null;

      child.kill("SIGTERM");

      const exited = await waitForExit(child, QUIT_GRACEFUL_TIMEOUT);
      if (!exited) {
        child.kill("SIGKILL");
        await waitForExit(child, QUIT_FORCE_TIMEOUT);
      }

      return;
    }

    // Never close an externally-detected instance we did not spawn
    if (this.detectedExternal) {
      return;
    }

    if (this.assignedPort === null) {
      return;
    }

    // Fallback: close via CDP Browser.close
    try {
      const targets = await discoverTargets(this.assignedPort);
      const first = targets[0];
      if (first) {
        await fetch(
          `http://127.0.0.1:${String(this.assignedPort)}/json/close/${first.id}`,
        );
      }
    } catch {
      // App may already be closed
    }
  }

  /**
   * Check whether LinkedHelper is running by probing its CDP endpoint.
   */
  async isRunning(): Promise<boolean> {
    if (this.assignedPort === null) {
      return false;
    }
    try {
      await discoverTargets(this.assignedPort);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Locate the LinkedHelper binary for the current platform.
   *
   * @throws {AppNotFoundError} if the binary does not exist at the
   *   expected location.
   */
  static findBinary(): string {
    const envPath = process.env["LINKEDHELPER_PATH"];
    if (envPath) {
      assertFileExists(envPath);
      return envPath;
    }

    const path = getDefaultBinaryPath();
    assertFileExists(path);
    return path;
  }
}

function getDefaultBinaryPath(): string {
  switch (process.platform) {
    case "darwin":
      return "/Applications/linked-helper.app/Contents/MacOS/linked-helper";
    case "win32":
      return join(
        process.env["LOCALAPPDATA"] ?? join(process.env["USERPROFILE"] ?? "C:\\Users\\Default", "AppData", "Local"),
        "Programs",
        "linked-helper",
        "linked-helper.exe",
      );
    default:
      return "/opt/linked-helper/linked-helper";
  }
}

/**
 * Wait for a child process to exit, with a timeout.
 *
 * @returns `true` if the process exited within the timeout, `false` otherwise.
 */
function waitForExit(child: ChildProcess, timeout: number): Promise<boolean> {
  if (child.exitCode !== null) {
    return Promise.resolve(true);
  }

  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeout);

    const onExit = () => {
      cleanup();
      resolve(true);
    };

    function cleanup() {
      child.removeListener("exit", onExit);
      clearTimeout(timer);
    }

    child.on("exit", onExit);
  });
}

/**
 * Send SIGKILL to each PID and wait for the processes to exit.
 */
async function killProcesses(pids: number[]): Promise<void> {
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Process may have already exited
    }
  }

  const deadline = Date.now() + QUIT_FORCE_TIMEOUT;
  while (Date.now() < deadline) {
    const alive = pids.filter((pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });
    if (alive.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function assertFileExists(path: string): void {
  try {
    accessSync(path, constants.X_OK);
  } catch {
    throw new AppNotFoundError(
      `LinkedHelper binary not found at ${path}. Set LINKEDHELPER_PATH to override.`,
    );
  }
}
