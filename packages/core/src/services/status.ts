// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import {
  type DiscoveredApp,
  type InstanceReadiness,
  type RunningInstance,
  findApp,
  readinessTracker,
  resolveLauncherPort,
  scanRunningInstances,
} from "../cdp/index.js";
import { DatabaseClient, discoverAllDatabases } from "../db/index.js";
import { ProfileRepository } from "../db/repositories/profile.js";
import { errorMessage } from "../utils/error-message.js";
import { LauncherService } from "./launcher.js";

/** Status of the LinkedHelper launcher process. */
export interface LauncherStatus {
  reachable: boolean;
  port: number | null;
  /** Detected LH processes (populated only when launcher is unreachable). */
  processes?: DiscoveredApp[];
}

/** Status of a single LinkedHelper account instance (launcher-derived). */
export interface AccountInstanceStatus {
  accountId: number;
  accountName: string;
  cdpPort: number | null;
}

/** Status of a single LinkedHelper database. */
export interface DatabaseStatus {
  accountId: number;
  path: string;
  profileCount: number;
}

/** Per-instance readiness entry in a status report. */
export interface InstanceReadinessEntry extends RunningInstance {
  /**
   * Readiness state derived from the process-scoped readiness tracker.
   *
   * - `"connectable"` — CDP probe succeeds; instance is healthy.
   * - `"starting"`    — process alive but never yet seen connectable.
   * - `"degraded"`    — was connectable before; temporarily unreachable
   *                     within the ~30 s grace window.
   * - `"stuck"`       — has been non-connectable past the grace window;
   *                     eligible for `restart-instance`.
   */
  readiness: InstanceReadiness;
}

/** Aggregated health-check result. */
export interface StatusReport {
  launcher: LauncherStatus;
  /**
   * Process-inspection-based instance list — the authoritative
   * "which accounts are started" source.  Works even when the launcher
   * CDP is unreachable.  Never contains --type= helper children.
   * Real CDP ports and identity are wired from live processes.
   * Each entry includes a `readiness` field.
   */
  instances: InstanceReadinessEntry[];
  /**
   * Backward-compat alias for `instances` — same data, kept for
   * callers that already reference this field name.
   */
  runningInstances: InstanceReadinessEntry[];
  databases: DatabaseStatus[];
  warnings?: string[];
}

/**
 * Perform a health check across LinkedHelper components.
 *
 * The function is intentionally fault-tolerant: individual component
 * failures are reported in the result rather than thrown as exceptions.
 *
 * When {@link cdpPort} is omitted, the launcher port is auto-discovered
 * via {@link resolveLauncherPort}.  If no launcher is available, the report
 * reflects this and still includes database and process information.
 *
 * `runningInstances` is always populated from process inspection (launcher-
 * independent) and is the authoritative source for which accounts are running.
 *
 * @param cdpPort - The CDP port of the LinkedHelper launcher (auto-discovered if omitted).
 */
export async function checkStatus(
  cdpPort?: number,
  options?: { host?: string; allowRemote?: boolean },
): Promise<StatusReport> {
  // Resolve launcher port: explicit, auto-discovered, or none
  let resolvedPort: number | null;
  try {
    resolvedPort = await resolveLauncherPort(cdpPort, options?.host, 0);
  } catch {
    resolvedPort = null;
  }

  const launcher: LauncherStatus = { reachable: false, port: resolvedPort };
  const databases: DatabaseStatus[] = [];
  const warnings: string[] = [];

  // 1. Process-inspection-based running instances (launcher-independent)
  let runningInstances: InstanceReadinessEntry[] = [];
  try {
    const raw = await scanRunningInstances();
    // Update the process-scoped readiness tracker and annotate each instance.
    const readinessMap = readinessTracker.update(raw);
    runningInstances = raw.map((inst) => ({
      ...inst,
      readiness: readinessMap.get(inst.pid) ?? "starting",
    }));
  } catch (error: unknown) {
    warnings.push(`Failed to scan running instances: ${errorMessage(error)}`);
  }

  // 2. Probe launcher (best-effort; failures don't block runningInstances)
  if (resolvedPort !== null) {
    const launcherService = new LauncherService(resolvedPort, options);
    try {
      await launcherService.connect();
      launcher.reachable = true;

      launcherService.disconnect();
    } catch (error: unknown) {
      launcherService.disconnect();
      warnings.push(`Launcher not reachable on port ${resolvedPort.toString()}: ${errorMessage(error)}`);

      // Enrich with process-level detection when CDP is unreachable
      const apps = await findApp();
      if (apps.length > 0) {
        launcher.processes = apps;
        warnings.push(
          `LinkedHelper process(es) detected (PID ${apps.map((a) => String(a.pid)).join(", ")}) but CDP not reachable. Restart may be needed.`,
        );
      }
    }
  } else {
    // No launcher port — check for running processes
    const apps = await findApp();
    if (apps.length > 0) {
      launcher.processes = apps;
      const connectableInstances = apps.filter(
        (a) => a.role === "instance" && a.connectable && a.cdpPort !== null,
      );
      if (connectableInstances.length > 0) {
        warnings.push(
          "Launcher CDP not available. Instance(s) detected — " +
            "instance-level operations work, but launcher operations " +
            "(list-accounts, start/stop-instance) are unavailable. " +
            "Relaunch LinkedHelper with --remote-debugging-port or use launch-app.",
        );
      } else if (runningInstances.length === 0) {
        warnings.push(
          `LinkedHelper process(es) detected (PID ${apps.map((a) => String(a.pid)).join(", ")}) ` +
            "but no CDP endpoints are reachable.",
        );
      }
    } else if (runningInstances.length === 0) {
      warnings.push("LinkedHelper is not running.");
    }
  }

  // 4. Check databases
  try {
    const dbMap = discoverAllDatabases();
    for (const [accountId, dbPath] of dbMap) {
      let profileCount = 0;
      try {
        const client = new DatabaseClient(dbPath);
        try {
          const repo = new ProfileRepository(client);
          profileCount = repo.getProfileCount();
        } finally {
          client.close();
        }
      } catch (error: unknown) {
        warnings.push(`Database unreadable at ${dbPath}: ${errorMessage(error)}`);
      }
      databases.push({ accountId, path: dbPath, profileCount });
    }
  } catch (error: unknown) {
    warnings.push(`Failed to discover databases: ${errorMessage(error)}`);
  }

  return {
    launcher,
    instances: runningInstances,
    runningInstances,
    databases,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
