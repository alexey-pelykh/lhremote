// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { type ChildProcess, execFile, spawn } from "node:child_process";
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
  /** Optional callback for diagnostic messages during launch (e.g. binary path, probe status). */
  onLog?: (message: string) => void;
  /** When true, attempt to make the launcher window visible after launch (Windows only). */
  visible?: boolean;
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
  private readonly onLog: ((message: string) => void) | undefined;
  private readonly visible: boolean;

  /**
   * @param cdpPort - Explicit CDP port.  When omitted, `launch()` will
   *   select a free port automatically via `get-port`.
   * @param options - Additional configuration options.
   */
  constructor(cdpPort?: number, options?: AppServiceOptions) {
    this.assignedPort = cdpPort ?? null;
    this.launchProbeDelay = options?.launchProbeDelay ?? DEFAULT_LAUNCH_PROBE_DELAY;
    this.force = options?.force ?? false;
    this.onLog = options?.onLog;
    this.visible = options?.visible ?? (process.platform === "win32");
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
      if (this.visible) {
        await this.bringLinkedHelperToFront();
      }
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
          if (this.visible) {
            await this.bringLinkedHelperToFront();
          }
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

    this.onLog?.(`Binary: ${binary}`);
    this.onLog?.(`Args: ${args.join(" ")}`);

    // Clear ELECTRON_RUN_AS_NODE so LH always starts as a GUI app, not a Node process.
    const childEnv = { ...process.env };
    delete childEnv["ELECTRON_RUN_AS_NODE"];

    const child = spawn(binary, args, {
      detached: true,
      stdio: "ignore",
      // windowsHide prevents Windows from creating a visible console window for
      // the Squirrel launcher process, which otherwise blocks proper background launch.
      windowsHide: true,
      env: childEnv,
    });

    child.on("exit", (code, signal) => {
      this.onLog?.(`Launcher process exited (code=${String(code)} signal=${String(signal)})`);
    });

    child.unref();

    // Wait briefly for a spawn error (e.g. ENOENT / permission denied).
    // Electron apps on Windows routinely exit their launcher process immediately
    // and re-spawn as the real GUI process, so a prompt exit is not an error.
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        cleanup();
        reject(new AppLaunchError(`Failed to launch LinkedHelper: ${err.message}`, { cause: err }));
      };

      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, 2000);

      function cleanup() {
        child.removeListener("error", onError);
        clearTimeout(timer);
      }

      child.on("error", onError);
    });

    // Best-effort: poll the CDP endpoint until the app is reachable or the
    // deadline passes.  On Windows, Electron re-spawns itself and the CDP
    // port may open well after the initial process exits, so a timeout here
    // is not treated as an error.  Use find-app / check-status to confirm.
    if (this.launchProbeDelay > 0) {
      this.onLog?.(`Probing CDP on port ${String(this.assignedPort)} (up to ${this.launchProbeDelay}ms)...`);
      const probeStart = Date.now();
      const probeDeadline = probeStart + this.launchProbeDelay;
      let probeSuccess = false;
      while (Date.now() < probeDeadline) {
        try {
          await discoverTargets(this.assignedPort as number);
          probeSuccess = true;
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      if (probeSuccess) {
        this.onLog?.(`CDP reachable after ${Date.now() - probeStart}ms`);
      } else {
        this.onLog?.(`CDP not yet reachable after ${this.launchProbeDelay}ms — app may still be starting`);
      }
    }

    this.childProcess = child;

    // If requested, attempt to make LinkedHelper's real desktop window visible.
    if (this.visible && this.assignedPort !== null) {
      await this.bringLinkedHelperToFront();
    }
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

    // Fallback: close via CDP. Electron launchers may expose no page
    // targets, so prefer target close when available and otherwise close
    // through the browser-level WebSocket from /json/version.
    try {
      const targets = await discoverTargets(this.assignedPort);
      const first = targets[0];
      if (first) {
        await fetch(
          `http://127.0.0.1:${String(this.assignedPort)}/json/close/${first.id}`,
        );
      } else {
        await closeBrowserViaCdp(this.assignedPort);
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

  private async bringLinkedHelperToFront(): Promise<void> {
    if (process.platform !== "win32") {
      return;
    }

    try {
      const apps = await findApp();
      const pids = apps.map((app) => app.pid);
      if (pids.length === 0) {
        this.onLog?.("No LinkedHelper processes found while trying to show the window");
        return;
      }

      const result = await showWindowsForPids(pids);
      if (result.length > 0) {
        this.onLog?.(`Brought LinkedHelper window to front: ${result}`);
      } else {
        this.onLog?.(`No top-level LinkedHelper window found for PIDs ${pids.join(", ")}`);
      }
    } catch (err) {
      this.onLog?.(`Failed to bring LinkedHelper window to front: ${String(err)}`);
    }
  }
}

function showWindowsForPids(pids: number[]): Promise<string> {
  const escapedPids = pids.map((pid) => String(pid)).join(",");
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class WindowTools {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

  public static List<IntPtr> FindWindows(uint[] pids) {
    var wanted = new HashSet<uint>(pids);
    var found = new List<IntPtr>();
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      uint pid;
      GetWindowThreadProcessId(hWnd, out pid);
      if (wanted.Contains(pid)) {
        found.Add(hWnd);
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  public static string GetTitle(IntPtr hWnd) {
    var builder = new StringBuilder(512);
    GetWindowText(hWnd, builder, builder.Capacity);
    return builder.ToString();
  }
}
"@

$pids = @(${escapedPids}) | ForEach-Object { [uint32]$_ }
$windows = [WindowTools]::FindWindows($pids)
$candidates = New-Object System.Collections.Generic.List[object]
foreach ($window in $windows) {
  $title = [WindowTools]::GetTitle($window)
  if ($title -eq 'MSCTFIME UI' -or $title -eq 'Default IME') { continue }
  $candidates.Add([pscustomobject]@{ Window = $window; Title = $title })
}

$linkedHelperWindows = @($candidates | Where-Object { $_.Title -like '*Linked Helper*' -or $_.Title -like '*LinkedHelper*' })
if ($linkedHelperWindows.Count -gt 0) {
  $candidates = $linkedHelperWindows
}

$shown = New-Object System.Collections.Generic.List[string]
foreach ($candidate in $candidates) {
  $window = $candidate.Window
  [WindowTools]::ShowWindowAsync($window, 9) | Out-Null
  [WindowTools]::SetForegroundWindow($window) | Out-Null
  $title = $candidate.Title
  if ($title.Length -eq 0) { $title = '<untitled>' }
  $shown.Add($title)
}
$shown -join ', '
`;

  return new Promise<string>((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          const message = stderr.trim() || error.message;
          reject(new Error(message));
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

interface CdpVersionResponse {
  webSocketDebuggerUrl?: string;
}

function closeBrowserViaCdp(port: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    void (async () => {
      let response: Response;
      try {
        response = await fetch(`http://127.0.0.1:${String(port)}/json/version`);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      if (!response.ok) {
        reject(new Error(`CDP version discovery returned HTTP ${response.status.toString()}`));
        return;
      }

      const version = await response.json() as CdpVersionResponse;
      if (!version.webSocketDebuggerUrl) {
        reject(new Error("CDP browser WebSocket URL not available"));
        return;
      }

      const ws = new WebSocket(version.webSocketDebuggerUrl);
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out closing browser via CDP"));
      }, 5000);

      const cleanup = () => {
        clearTimeout(timeout);
        ws.removeEventListener("open", onOpen);
        ws.removeEventListener("message", onMessage);
        ws.removeEventListener("close", onClose);
        ws.removeEventListener("error", onError);
      };

      const onOpen = () => {
        ws.send(JSON.stringify({ id: 1, method: "Browser.close" }));
      };

      const onMessage = (event: MessageEvent) => {
        try {
          const payload = JSON.parse(String(event.data)) as { id?: number; error?: { message?: string } };
          if (payload.id !== 1) {
            return;
          }
          cleanup();
          if (payload.error) {
            reject(new Error(payload.error.message ?? "Browser.close failed"));
            return;
          }
          resolve();
        } catch (error) {
          cleanup();
          reject(error instanceof Error ? error : new Error(String(error)));
        } finally {
          ws.close();
        }
      };

      const onClose = () => {
        cleanup();
        resolve();
      };

      const onError = () => {
        cleanup();
        reject(new Error("Browser CDP WebSocket error"));
      };

      ws.addEventListener("open", onOpen);
      ws.addEventListener("message", onMessage);
      ws.addEventListener("close", onClose);
      ws.addEventListener("error", onError);
    })();
  });
}

function getDefaultBinaryPath(): string {
  switch (process.platform) {
    case "darwin":
      return "/Applications/linked-helper.app/Contents/MacOS/linked-helper";
    case "win32":
      return getWindowsBinaryPath();
    default:
      return "/opt/linked-helper/linked-helper";
  }
}

function getWindowsBinaryPath(): string {
  const localAppData =
    process.env["LOCALAPPDATA"] ??
    join(process.env["USERPROFILE"] ?? "C:\\Users\\Default", "AppData", "Local");
  const programFiles = process.env["PROGRAMFILES"] ?? "C:\\Program Files";
  const programFilesX86 = process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)";

  const candidates = [
    // Squirrel per-user install (most common on Windows)
    join(localAppData, "linked-helper", "linked-helper.exe"),
    join(localAppData, "LinkedHelper", "linked-helper.exe"),
    join(localAppData, "linked-helper", "LinkedHelper.exe"),
    join(localAppData, "LinkedHelper", "LinkedHelper.exe"),
    // Programs subfolder variants
    join(localAppData, "Programs", "linked-helper", "linked-helper.exe"),
    join(localAppData, "Programs", "LinkedHelper", "linked-helper.exe"),
    join(localAppData, "Programs", "linked-helper", "LinkedHelper.exe"),
    join(localAppData, "Programs", "LinkedHelper", "LinkedHelper.exe"),
    // System-wide installs
    join(programFiles, "linked-helper", "linked-helper.exe"),
    join(programFiles, "LinkedHelper", "linked-helper.exe"),
    join(programFilesX86, "linked-helper", "linked-helper.exe"),
    join(programFilesX86, "LinkedHelper", "linked-helper.exe"),
  ];

  for (const candidate of candidates) {
    if (fileExists(candidate)) {
      return candidate;
    }
  }

  throw new AppNotFoundError(
    `LinkedHelper binary not found. Searched:\n${candidates.map((c) => `  ${c}`).join("\n")}\nSet LINKEDHELPER_PATH to override.`,
  );
}

function fileExists(path: string): boolean {
  try {
    accessSync(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
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
  if (!fileExists(path)) {
    throw new AppNotFoundError(
      `LinkedHelper binary not found at ${path}. Set LINKEDHELPER_PATH to override.`,
    );
  }
}
