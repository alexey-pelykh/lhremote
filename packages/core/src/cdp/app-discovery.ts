// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { pidToPorts } from "pid-port";
import psList from "ps-list";
import { LinkedHelperNotRunningError, LinkedHelperUnreachableError } from "../services/errors.js";
import { isCdpPort } from "../utils/cdp-port.js";
import { isLoopbackAddress } from "../utils/loopback.js";

/**
 * Known LinkedHelper binary names across platforms.
 */
const BINARY_NAMES = ["linked-helper", "linked-helper.exe"];

/**
 * Role of a discovered LinkedHelper process.
 *
 * - `"launcher"` — the top-level process that manages accounts and instances.
 * - `"instance"` — a child process spawned by the launcher for a LinkedIn account.
 * - `"unknown"` — role could not be determined from the process tree.
 */
export type AppRole = "launcher" | "instance" | "unknown";

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
   * Whether this process is the launcher or an instance.
   *
   * Determined by the process tree: a launcher's direct parent is NOT
   * another LinkedHelper process, while an instance's direct parent is.
   */
  role: AppRole;
}

/**
 * Scan the system for running LinkedHelper application processes.
 *
 * For each matching process, attempts to detect a CDP debugging port
 * by inspecting its listening TCP ports and probing them with an HTTP
 * request to the CDP `/json/list` endpoint.
 *
 * Each process is classified as `"launcher"` or `"instance"` based on
 * the process tree: a launcher's parent is NOT another LinkedHelper
 * process, while an instance is a descendant of the launcher.
 *
 * @returns An array of discovered LinkedHelper processes (may be empty).
 */
export async function findApp(): Promise<DiscoveredApp[]> {
  const processes = await listLinkedHelperProcesses();
  if (processes.length === 0) {
    return [];
  }

  const pidSet = new Set(processes.map((p) => p.pid));
  const roledProcesses = processes.map((p) => ({
    pid: p.pid,
    role: classifyRole(p, pidSet),
  }));

  return Promise.all(
    roledProcesses.map((p) => probeProcess(p.pid, p.role)),
  );
}

/**
 * Discover the CDP port for a running LinkedHelper process with the
 * specified role.
 *
 * Scans running processes via {@link findApp} and returns the first
 * connectable port matching the requested role.
 *
 * @param role - Process role to look for (`"launcher"` or `"instance"`).
 * @returns The CDP port number.
 * @throws {LinkedHelperNotRunningError} if no LinkedHelper processes are found.
 * @throws {LinkedHelperUnreachableError} if processes are found but none are
 *   connectable with the requested role.
 */
export async function resolveAppPort(
  role: "launcher" | "instance",
): Promise<number> {
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

  throw new LinkedHelperUnreachableError(apps);
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
): Promise<number> {
  if (cdpPort !== undefined) return cdpPort;
  if (cdpHost !== undefined && !isLoopbackAddress(cdpHost)) {
    throw new Error("cdpPort is required when using a non-loopback cdpHost — auto-discovery only works locally");
  }
  return resolveAppPort("instance");
}

/**
 * Resolve the launcher CDP port, requiring an explicit port for non-loopback hosts.
 *
 * Analogous to {@link resolveInstancePort} but discovers the launcher role.
 *
 * @param cdpPort - Explicit CDP port (returned verbatim when provided).
 * @param cdpHost - Target host for the CDP connection.
 * @returns The resolved CDP port number.
 */
export async function resolveLauncherPort(
  cdpPort?: number,
  cdpHost?: string,
): Promise<number> {
  if (cdpPort !== undefined) return cdpPort;
  if (cdpHost !== undefined && !isLoopbackAddress(cdpHost)) {
    throw new Error("cdpPort is required when using a non-loopback cdpHost — auto-discovery only works locally");
  }
  return resolveAppPort("launcher");
}

/**
 * A LinkedHelper process entry from ps-list.
 */
interface LHProcess {
  pid: number;
  ppid: number;
}

/**
 * List LinkedHelper processes with their parent PIDs.
 */
async function listLinkedHelperProcesses(): Promise<LHProcess[]> {
  try {
    const all = await psList();
    return all
      .filter((p) => BINARY_NAMES.includes(p.name))
      .map((p) => ({ pid: p.pid, ppid: p.ppid }));
  } catch {
    return [];
  }
}

/**
 * Classify a LinkedHelper process as launcher or instance.
 *
 * A launcher's direct parent PID is NOT in the set of LinkedHelper
 * PIDs (its parent is the shell, init, or launchd).  An instance's
 * direct parent is the launcher or another LinkedHelper subprocess.
 */
function classifyRole(proc: LHProcess, lhPids: Set<number>): AppRole {
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
