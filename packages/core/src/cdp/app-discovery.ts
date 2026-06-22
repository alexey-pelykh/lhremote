// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { pidToPorts } from "pid-port";

import { LinkedHelperNotRunningError, LinkedHelperUnreachableError } from "../services/errors.js";
import { delay } from "../utils/index.js";
import { isCdpPort } from "../utils/cdp-port.js";
import { isLoopbackAddress } from "../utils/loopback.js";
import type { InstanceIdentity } from "./process-inspector.js";
import { parseIdentityFromCmdline } from "./process-inspector.js";
import { gatherRawProcesses } from "./gather-raw-processes.js";
import type { RawProcess } from "./gather-raw-processes.js";

/**
 * Known LinkedHelper binary names across platforms.
 */
const BINARY_NAMES_LOWERCASE = new Set([
  "linked-helper",
  "linked-helper.exe",
  "linkedhelper",
  "linkedhelper.exe",
]);

/**
 * Role of a discovered LinkedHelper process.
 *
 * - `"launcher"` — the top-level process that manages accounts and instances.
 * - `"instance"` — an account-instance main process spawned by the launcher.
 * - `"helper-child"` — a Chromium helper subprocess (gpu/renderer/utility/crashpad).
 *   These share the same binary name but have `--type=` in their command line.
 *   They never expose a CDP port and are never true instances.
 * - `"unknown"` — role could not be determined from the process tree.
 */
export type AppRole = "launcher" | "instance" | "helper-child" | "unknown";

/**
 * Result of discovering a running LinkedHelper application process.
 */
export interface DiscoveredApp {
  /** OS process ID. */
  pid: number;

  /** CDP port the process is listening on, or `null` if none detected. */
  cdpPort: number | null;

  /** Whether the CDP endpoint responded to a probe. */
  connectable: boolean;

  /**
   * Role of this process.
   *
   * Classification uses command-line analysis when available:
   * - `--type=` flag → `"helper-child"` (never a real instance).
   * - `resources[\/]out[\/]` path + no `--type=` → `"instance"`.
   * - No `resources[\/]out[\/]` → `"launcher"`.
   * Falls back to parent-PID heuristic when command lines are unavailable.
   */
  role: AppRole;

  /**
   * Account identity resolved from the process command line.
   * Only present for `role === "instance"` processes.
   * Never contains credentials or secrets.
   */
  identity?: InstanceIdentity;

  /**
   * Number of `--type=` Chromium helper child processes (gpu/renderer/utility/crashpad)
   * whose parent PID is this process.
   */
  helperChildCount?: number;

  /**
   * Parent process ID. Only present for `role === "helper-child"` entries
   * (visible when `includeHelpers` is true).
   */
  parentPid?: number;
}

/**
 * Options for {@link findApp}.
 */
export interface FindAppOptions {
  /**
   * When true, include `--type=` Chromium helper child processes in the result.
   * They appear with `role: "helper-child"` and `parentPid` set.
   * Default: false (helpers are omitted from the default output).
   */
  includeHelpers?: boolean;
}

/**
 * Scan the system for running LinkedHelper application processes.
 *
 * For each matching process, attempts to detect a CDP debugging port
 * by inspecting its listening TCP ports and probing them with an HTTP
 * request to the CDP `/json/list` endpoint.
 *
 * Role classification uses command-line analysis (the `--type=` flag identifies
 * helper children; the executable path identifies instance main processes).
 * On Windows, command lines are obtained via Win32_Process to guarantee correct
 * classification — the ps-list `cmd` field is not available on Windows.
 *
 * By default, `--type=` helper children are excluded from the result; their
 * count is reflected in `helperChildCount` on the owning instance or launcher.
 * Pass `{ includeHelpers: true }` to include them (e.g. for diagnostics).
 *
 * Account identity (`identity` field) is populated for instance main
 * processes from a security-allowlisted command-line parser.
 *
 * @returns An array of discovered LinkedHelper processes (may be empty).
 *   Connectable entries appear before non-connectable ones; within each
 *   group, launchers precede instances.
 */
export async function findApp(options: FindAppOptions = {}): Promise<DiscoveredApp[]> {
  const allProcs = await gatherRawProcesses().catch((): RawProcess[] => []);
  const lhProcs = allProcs.filter((p) =>
    BINARY_NAMES_LOWERCASE.has(p.name.toLowerCase()),
  );

  if (lhProcs.length === 0) return [];

  const lhPids = new Set(lhProcs.map((p) => p.pid));

  // First pass: identify helper children and count per parent PID
  const helperCounts = new Map<number, number>();
  const helperProcs: RawProcess[] = [];

  for (const proc of lhProcs) {
    if (classifyRole(proc, lhPids) === "helper-child") {
      helperCounts.set(proc.ppid, (helperCounts.get(proc.ppid) ?? 0) + 1);
      helperProcs.push(proc);
    }
  }

  // Second pass: probe and build DiscoveredApp for non-helper processes
  const discovered: DiscoveredApp[] = [];

  for (const proc of lhProcs) {
    const role = classifyRole(proc, lhPids);
    if (role === "helper-child") continue;

    const app = await probeProcess(proc.pid, role);
    app.helperChildCount = helperCounts.get(proc.pid) ?? 0;

    if (role === "instance" && proc.cmdline) {
      app.identity = parseIdentityFromCmdline(proc.cmdline);
    }

    discovered.push(app);
  }

  // Sort: connectable first, then launcher before instance
  const roleOrder: AppRole[] = ["launcher", "instance", "unknown", "helper-child"];
  discovered.sort((a, b) => {
    if (a.connectable !== b.connectable) return a.connectable ? -1 : 1;
    return roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role);
  });

  // Optionally append helper children
  if (options.includeHelpers) {
    for (const proc of helperProcs) {
      discovered.push({
        pid: proc.pid,
        cdpPort: null,
        connectable: false,
        role: "helper-child",
        parentPid: proc.ppid,
        helperChildCount: 0,
      });
    }
  }

  return discovered;
}

/**
 * How long to retry when LH processes exist but CDP is unreachable (ms).
 * LH briefly drops its CDP port while reconnecting to existing instances
 * after a fresh launch — 30 s is enough to ride out that window.
 * Tests may pass 0 to disable retries and get an immediate failure.
 */
export const REACHABILITY_RETRY_TIMEOUT = 30_000;
const REACHABILITY_RETRY_INTERVAL = 1_000;

/**
 * Discover the CDP port for a running LinkedHelper process with the
 * specified role.
 *
 * Scans running processes via {@link findApp} and returns the first
 * connectable port matching the requested role. When processes are found
 * but none are connectable, retries every second for up to
 * {@link REACHABILITY_RETRY_TIMEOUT} ms (LH briefly drops its CDP port
 * while reconciling instances after a fresh launch).
 *
 * @param role - Process role to look for (`"launcher"` or `"instance"`).
 * @param retryTimeout - How long to retry when processes are found but
 *   unreachable (ms). Pass `0` for immediate failure (useful in tests or
 *   best-effort callers).
 * @returns The CDP port number.
 * @throws {LinkedHelperNotRunningError} if no LinkedHelper processes are found.
 * @throws {LinkedHelperUnreachableError} if processes are found but none are
 *   connectable with the requested role within `retryTimeout` ms.
 */
export async function resolveAppPort(
  role: "launcher" | "instance",
  retryTimeout = REACHABILITY_RETRY_TIMEOUT,
): Promise<number> {
  const deadline = Date.now() + retryTimeout;
  let lastApps: Awaited<ReturnType<typeof findApp>> = [];

  while (true) {
    const apps = await findApp();

    if (apps.length === 0) {
      throw new LinkedHelperNotRunningError();
    }

    const match = apps.find(
      (a) => a.role === role && a.connectable && a.cdpPort !== null,
    );
    if (match?.cdpPort !== null && match?.cdpPort !== undefined) {
      return match.cdpPort;
    }

    lastApps = apps;
    if (Date.now() >= deadline) break;

    // LH may be temporarily unreachable while reconciling instance state;
    // retry until the deadline rather than failing immediately.
    await delay(REACHABILITY_RETRY_INTERVAL);
  }

  throw new LinkedHelperUnreachableError(lastApps);
}

/**
 * Resolve the instance CDP port, requiring an explicit port for non-loopback hosts.
 *
 * When {@link cdpPort} is provided it is returned as-is.  When it is
 * omitted and the host is loopback (or omitted), the port is
 * auto-discovered via {@link resolveAppPort}.  For non-loopback hosts
 * auto-discovery cannot work (it scans local processes), so an error
 * is thrown to prevent silently connecting to the wrong endpoint.
 *
 * @param cdpPort - Explicit CDP port (returned verbatim when provided).
 * @param cdpHost - Target host for the CDP connection.
 * @returns The resolved CDP port number.
 */
export async function resolveInstancePort(
  cdpPort?: number,
  cdpHost?: string,
  retryTimeout = REACHABILITY_RETRY_TIMEOUT,
): Promise<number> {
  if (cdpPort !== undefined) return cdpPort;
  if (cdpHost !== undefined && !isLoopbackAddress(cdpHost)) {
    throw new Error("cdpPort is required when using a non-loopback cdpHost — auto-discovery only works locally");
  }
  return resolveAppPort("instance", retryTimeout);
}

/**
 * Resolve the launcher CDP port, requiring an explicit port for non-loopback hosts.
 *
 * Analogous to {@link resolveInstancePort} but discovers the launcher role.
 *
 * @param cdpPort - Explicit CDP port (returned verbatim when provided).
 * @param cdpHost - Target host for the CDP connection.
 * @param retryTimeout - How long to retry when processes are found but
 *   unreachable (ms). Defaults to {@link REACHABILITY_RETRY_TIMEOUT}. Pass `0`
 *   for fast-fail behavior (health checks, best-effort probes).
 * @returns The resolved CDP port number.
 */
export async function resolveLauncherPort(
  cdpPort?: number,
  cdpHost?: string,
  retryTimeout = REACHABILITY_RETRY_TIMEOUT,
): Promise<number> {
  if (cdpPort !== undefined) return cdpPort;
  if (cdpHost !== undefined && !isLoopbackAddress(cdpHost)) {
    throw new Error("cdpPort is required when using a non-loopback cdpHost — auto-discovery only works locally");
  }
  return resolveAppPort("launcher", retryTimeout);
}

/**
 * Classify a LinkedHelper process as launcher, instance, or helper-child.
 *
 * Uses command-line analysis when available (the `--type=` flag identifies
 * helper children; the `resources/out/` path identifies instance mains).
 * Falls back to parent-PID heuristic when no command line is available.
 */
function classifyRole(
  proc: Pick<RawProcess, "ppid" | "cmdline">,
  lhPids: Set<number>,
): AppRole {
  if (proc.cmdline) {
    if (/--type=/.test(proc.cmdline)) return "helper-child";
    if (/resources[/\\]out[/\\]/i.test(proc.cmdline)) return "instance";
    return "launcher";
  }
  return lhPids.has(proc.ppid) ? "instance" : "launcher";
}

/**
 * Probe a single process for CDP connectivity.
 */
async function probeProcess(pid: number, role: AppRole): Promise<DiscoveredApp> {
  let ports: Set<number>;
  try {
    ports = await pidToPorts(pid);
  } catch {
    return { pid, cdpPort: null, connectable: false, role };
  }

  for (const port of ports) {
    if (await isCdpPort(port)) {
      return { pid, cdpPort: port, connectable: true, role };
    }
  }

  // Process is running but no CDP port detected (or none responding)
  const firstPort = [...ports][0] ?? null;
  return { pid, cdpPort: firstPort, connectable: false, role };
}
