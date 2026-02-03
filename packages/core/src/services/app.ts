import { type ChildProcess, spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { join } from "node:path";

import getPort from "get-port";

import { discoverTargets } from "../cdp/index.js";
import { AppLaunchError, AppNotFoundError } from "./errors.js";

/** Default delay after spawn before checking if the app is reachable (ms). */
const DEFAULT_LAUNCH_PROBE_DELAY = 3000;

export interface AppServiceOptions {
  /** Delay in ms after spawn before checking if the app is reachable (default 3000). */
  launchProbeDelay?: number;
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
  private readonly launchProbeDelay: number;

  /**
   * @param cdpPort - Explicit CDP port.  When omitted, `launch()` will
   *   select a free port automatically via `get-port`.
   * @param options - Additional configuration options.
   */
  constructor(cdpPort?: number, options?: AppServiceOptions) {
    this.assignedPort = cdpPort ?? null;
    this.launchProbeDelay = options?.launchProbeDelay ?? DEFAULT_LAUNCH_PROBE_DELAY;
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
    if (this.assignedPort !== null && await this.isRunning()) {
      return;
    }

    if (this.assignedPort === null) {
      this.assignedPort = await getPort();
    }

    const binary = AppService.findBinary();
    const args = [`--remote-debugging-port=${String(this.assignedPort)}`];

    const child = spawn(binary, args, {
      detached: true,
      stdio: "ignore",
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
   * Sends `SIGTERM` to the spawned process. If the process was not
   * spawned by this service, attempts to close via CDP.
   */
  async quit(): Promise<void> {
    if (this.childProcess) {
      this.childProcess.kill("SIGTERM");
      this.childProcess = null;
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

function assertFileExists(path: string): void {
  try {
    accessSync(path, constants.X_OK);
  } catch {
    throw new AppNotFoundError(
      `LinkedHelper binary not found at ${path}. Set LINKEDHELPER_PATH to override.`,
    );
  }
}
