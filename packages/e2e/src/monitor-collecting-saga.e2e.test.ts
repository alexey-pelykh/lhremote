// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * E2E smoke test for `monitorCollectingSaga` (#792).
 *
 * Validates the monitor end-to-end against a live LH process:
 *   - Probe script (`mw.isCollecting` / `mw.isPreparingCollecting` via the
 *     `@electron/remote` proxy) works against real LH and returns the
 *     expected shape.
 *   - With `allowImmediateIdle: true` (default) and no saga running, the
 *     monitor returns cleanly with `reachedIdle: true`.
 *   - With `allowImmediateIdle: false` and no saga running, the monitor
 *     times out within the configured deadline (validates the timeout
 *     error path).
 *
 * Does NOT exercise a full collect-people saga — that takes ~9 min and
 * tests the END-TO-END integration in `collect-people.e2e.test.ts` would
 * cover that.  This file is the FOCUSED smoke test that confirms the
 * core function is callable against real LH and the building blocks the
 * spike (`saga-control-spike.e2e.test.ts`) verified compose correctly
 * inside the production helper.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  describeE2E,
  forceStopInstance,
  launchApp,
  quitApp,
  resolveAccountId,
  retryAsync,
} from "@lhremote/core/testing";
import {
  type AppService,
  discoverInstancePort,
  InstanceService,
  LauncherService,
  MonitorCollectingSagaTimeoutError,
  monitorCollectingSaga,
  startInstanceWithRecovery,
} from "@lhremote/core";

describeE2E("monitor-collecting-saga", () => {
  let app: AppService;
  let port: number;
  let accountId: number;
  let instance: InstanceService;

  beforeAll(async () => {
    const launched = await launchApp();
    app = launched.app;
    port = launched.port;

    accountId = await resolveAccountId(port);

    const launcher = new LauncherService(port);
    try {
      await retryAsync(() => launcher.connect(), { retries: 3, delay: 1_000 });
      await startInstanceWithRecovery(launcher, accountId, port);
    } finally {
      launcher.disconnect();
    }

    const instancePort = await retryAsync(
      async () => {
        const p = await discoverInstancePort(port);
        if (p === null) throw new Error("Instance CDP port not discovered yet");
        return p;
      },
      { retries: 30, delay: 2_000 },
    );

    instance = new InstanceService(instancePort);
    await instance.connect();
  }, 180_000);

  afterAll(async () => {
    instance?.disconnect();

    const launcher = new LauncherService(port);
    try {
      await launcher.connect();
      await forceStopInstance(launcher, accountId, port);
    } catch {
      // Best-effort cleanup
    } finally {
      launcher.disconnect();
    }
    await quitApp(app);
  }, 60_000);

  describe("against an idle LH (no saga running)", () => {
    it("returns reachedIdle: true immediately when allowImmediateIdle is the default", async () => {
      // No collect operation has been fired — `mw.isCollecting` should be false.
      const result = await monitorCollectingSaga(instance, {
        timeout: 30_000,
        pollInterval: 1_000,
      });

      expect(result.reachedIdle).toBe(true);
      expect(result.recoveryEvents).toBe(0);
      expect(result.popupsDismissed).toBe(0);
      expect(result.unrecoverablePopups).toEqual([]);
      // Should return very quickly (single probe + categorization)
      expect(result.durationMs).toBeLessThan(10_000);
    }, 60_000);

    it("times out when allowImmediateIdle is false and no saga is fired", async () => {
      // With allowImmediateIdle=false, the monitor MUST observe sagaActive=true
      // at least once before considering subsequent idle as "saga finished".
      // Since no saga is running, this should time out cleanly.
      const start = Date.now();
      let caught: unknown = null;
      try {
        await monitorCollectingSaga(instance, {
          timeout: 5_000,
          pollInterval: 1_000,
          allowImmediateIdle: false,
        });
      } catch (err) {
        caught = err;
      }
      const elapsed = Date.now() - start;

      expect(caught).toBeInstanceOf(MonitorCollectingSagaTimeoutError);
      expect(elapsed).toBeGreaterThanOrEqual(4_000);
      expect(elapsed).toBeLessThan(15_000);

      const e = caught as MonitorCollectingSagaTimeoutError;
      expect(e.recoveryEvents).toBe(0);
      expect(e.popupsDismissed).toBe(0);
      expect(e.waitedMs).toBeGreaterThanOrEqual(4_000);
    }, 30_000);
  });
});
