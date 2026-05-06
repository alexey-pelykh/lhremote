// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import path from "node:path";

import {
  type AppService,
  AppNotFoundError,
  discoverInstancePort,
  discoverTargets,
  gateOnLoggedInState,
  LauncherService,
  startInstanceWithRecovery,
} from "@lhremote/core";
import {
  forceStopInstance,
  launchApp,
  quitApp,
  resolveAccountId,
  retryAsync,
} from "@lhremote/core/testing";

/**
 * Deadline for the suite-level health gate (120s).  Same shape as the
 * per-op default in `waitForLoggedInState` (60s) plus headroom for the
 * one-off LH bring-up + LinkedIn target hydration that the gate has to
 * pay before it can even probe.
 */
const HEALTH_GATE_TIMEOUT_MS = 120_000;

/**
 * Phase markers for failure-message scoping.  When the gate fails, the
 * message references which phase failed so users don't see "did not
 * enter LoggedInState" when LH didn't even launch.
 */
type Phase =
  | "launching LH"
  | "resolving account"
  | "starting instance"
  | "discovering instance CDP port"
  | "waiting for LinkedIn target"
  | "waiting for LoggedInState";

/**
 * Suite-level "CW health gate" (issue #783, research §11.6).
 *
 * Runs ONCE before any E2E test file.  Verifies that LinkedHelper +
 * LinkedIn are in a state where the suite can plausibly succeed: launch
 * LH, pick an account, start an instance, wait for LoggedInState.  If
 * the gate fails (LinkedIn checkpoint, persistent re-auth, account
 * locked out, etc.) abort the whole suite up front instead of cascading
 * through 60+ tests with the same root cause.
 *
 * The gate's instance is torn down at the end so per-test `beforeAll`
 * hooks see a clean slate (each test still launches its own LH +
 * instance via `launchApp` + `startInstanceWithRecovery`).
 */
export default async function globalSetup(): Promise<void> {
  // Only run for the @lhremote/e2e package.  The shared vitest.e2e.config.ts
  // is also used by core/cli/mcp/lhremote packages (which have no e2e test
  // files and rely on passWithNoTests).  Without this guard, globalSetup
  // would launch + quit LH four extra times per `pnpm test:e2e`.  Use
  // `path.sep` so the comparison works on Windows (backslash) as well.
  if (!process.cwd().endsWith(`${path.sep}packages${path.sep}e2e`)) {
    return;
  }

  process.stdout.write(
    "[E2E health gate] Verifying LinkedIn ContentWindow state...\n",
  );

  let app: AppService | undefined;
  let port: number | undefined;
  let accountId: number | undefined;
  let phase: Phase = "launching LH";

  try {
    let launched: { app: AppService; port: number };
    try {
      launched = await launchApp();
    } catch (err) {
      // LH binary not installed — skip the gate gracefully so suites can
      // still run on machines without LH (the per-file `beforeAll` hooks
      // already surface the same AppNotFoundError per file, with clearer
      // attribution).
      if (err instanceof AppNotFoundError) {
        process.stdout.write(
          "[E2E health gate] Skipped — LinkedHelper binary not found.\n",
        );
        return;
      }
      throw err;
    }
    app = launched.app;
    port = launched.port;
    const launcherPort = port;

    phase = "resolving account";
    accountId = await resolveAccountId(launcherPort);

    phase = "starting instance";
    const launcher = new LauncherService(launcherPort);
    try {
      await retryAsync(() => launcher.connect(), { retries: 3, delay: 1_000 });
      await startInstanceWithRecovery(launcher, accountId, launcherPort);
    } finally {
      launcher.disconnect();
    }

    phase = "discovering instance CDP port";
    const cdpPort = await retryAsync(
      async () => {
        const p = await discoverInstancePort(launcherPort);
        if (p === null) {
          throw new Error("Instance CDP port not discovered yet");
        }
        return p;
      },
      { retries: 30, delay: 2_000 },
    );

    phase = "waiting for LinkedIn target";
    await retryAsync(
      async () => {
        const targets = await discoverTargets(cdpPort);
        const hasLinkedIn = targets.some(
          (t) => t.type === "page" && t.url?.includes("linkedin.com"),
        );
        if (!hasLinkedIn) {
          throw new Error("LinkedIn target not yet available");
        }
      },
      { retries: 30, delay: 2_000 },
    );

    phase = "waiting for LoggedInState";
    await gateOnLoggedInState(cdpPort, "127.0.0.1", false, {
      timeout: HEALTH_GATE_TIMEOUT_MS,
    });

    process.stdout.write(
      "[E2E health gate] OK — LinkedIn ContentWindow is in LoggedInState\n",
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      [
        "",
        "⚠ E2E HEALTH GATE FAILED",
        `Phase: ${phase}`,
        `Cause: ${message}`,
        "",
        "Most likely:",
        "  - LinkedIn served a security checkpoint — open LH and resolve manually",
        "  - Account is in a transient li-logged-in-loading state — retry in a few minutes",
        "  - Network / VPN issue blocking LinkedIn",
        "  - LH itself is misconfigured (no accounts, instance failed to start)",
        "",
        "Aborting suite to avoid cascading failures across every E2E test.",
        "",
      ].join("\n"),
    );
    throw err;
  } finally {
    if (port !== undefined && accountId !== undefined) {
      const cleanupLauncher = new LauncherService(port);
      try {
        await cleanupLauncher.connect();
        await forceStopInstance(cleanupLauncher, accountId, port);
      } catch {
        // best-effort cleanup; teardown failures must not mask gate failures
      } finally {
        cleanupLauncher.disconnect();
      }
    }
    if (app !== undefined) {
      // Pass `port` so quitApp can dismiss the "All instances will be closed"
      // popup concurrently — see e2e-helpers.ts § quitApp.
      await quitApp(app, port);
    }
  }
}
