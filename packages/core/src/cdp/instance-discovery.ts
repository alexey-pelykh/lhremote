// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { pidToPorts, portToPid } from "pid-port";
import psList from "ps-list";
import { DEFAULT_CDP_PORT } from "../constants.js";
import { isCdpPort } from "../utils/cdp-port.js";

/**
 * Discover the dynamic CDP port of a running LinkedHelper instance process.
 *
 * LinkedHelper spawns a separate Electron process for each LinkedIn account.
 * That process listens for CDP connections on a dynamic port that changes
 * every session.  This function discovers the port cross-platform using
 * `pid-port` and `ps-list`.
 *
 * The heuristic is:
 * 1. Find the launcher PID by looking for a process listening on `launcherPort`.
 * 2. Find child processes of the launcher.
 * 3. Among those children, find one listening on a TCP port that is NOT the
 *    launcher port and that responds to the CDP `/json/list` endpoint.
 *
 * The instance process may listen on multiple ports (e.g. a web content
 * server and a CDP debugging server).  We probe each candidate with an
 * HTTP fetch to `/json/list` to ensure we return the actual CDP port.
 *
 * @param launcherPort - The known launcher CDP port (default 9222).
 * @returns The dynamic instance CDP port, or `null` if no running instance was found.
 */
export async function discoverInstancePort(
  launcherPort: number = DEFAULT_CDP_PORT,
): Promise<number | null> {
  const launcherPid = await findPidListeningOn(launcherPort);
  if (launcherPid === null) {
    return null;
  }

  const descendantPids = await findDescendantPids(launcherPid);
  if (descendantPids.length === 0) {
    return null;
  }

  const results = await Promise.all(
    descendantPids.map((pid) => findCdpPort(pid, launcherPort)),
  );
  return results.find((port) => port !== null) ?? null;
}

/**
 * Find the PID of a process listening on the given TCP port.
 */
async function findPidListeningOn(port: number): Promise<number | null> {
  try {
    const pid = await portToPid({ port, host: "*" });
    return pid ?? null;
  } catch {
    return null;
  }
}

/**
 * Find PIDs of all descendant processes for the given ancestor PID.
 *
 * Walks the full process tree rather than only direct children, because
 * LinkedHelper may spawn instance processes through intermediate helpers
 * (e.g. GPU or renderer processes), making them grandchildren or deeper.
 */
async function findDescendantPids(ancestorPid: number): Promise<number[]> {
  try {
    const processes = await psList();
    const descendants: number[] = [];
    const queue = [ancestorPid];
    const visited = new Set<number>([ancestorPid]);

    let currentPid: number | undefined;
    while ((currentPid = queue.shift()) !== undefined) {
      for (const p of processes) {
        if (p.ppid === currentPid && !visited.has(p.pid)) {
          visited.add(p.pid);
          descendants.push(p.pid);
          queue.push(p.pid);
        }
      }
    }

    return descendants;
  } catch {
    return [];
  }
}

/**
 * Find the CDP debugging port for the given PID.
 *
 * Tries each listening port (excluding `excludePort`) with an HTTP fetch
 * to `/json/list`.  Returns the first port that responds successfully.
 */
async function findCdpPort(
  pid: number,
  excludePort: number,
): Promise<number | null> {
  let ports: Set<number>;
  try {
    ports = await pidToPorts(pid);
  } catch {
    return null;
  }

  const candidates = [...ports].filter((p) => p !== excludePort);
  if (candidates.length === 0) {
    return null;
  }

  try {
    return await Promise.any(
      candidates.map(async (port) => {
        if (await isCdpPort(port)) {
          return port;
        }
        throw new Error("not CDP");
      }),
    );
  } catch {
    // AggregateError — no candidate port responded to CDP
    return null;
  }
}

/**
 * Find and forcefully kill all instance child processes of the launcher.
 *
 * Use as a last resort when graceful `stopInstance()` fails and
 * the instance process needs to be terminated at the OS level.
 */
export async function killInstanceProcesses(
  launcherPort: number,
): Promise<void> {
  const launcherPid = await findPidListeningOn(launcherPort);
  if (launcherPid === null) {
    return;
  }

  const descendantPids = await findDescendantPids(launcherPid);
  for (const pid of descendantPids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Process may already be dead
    }
  }
}
