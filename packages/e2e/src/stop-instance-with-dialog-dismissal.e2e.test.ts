// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

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
  LauncherService,
  startInstanceWithRecovery,
} from "@lhremote/core";

describeE2E("stopInstanceWithDialogDismissal", () => {
  let app: AppService;
  let port: number;
  let accountId: number;

  beforeAll(async () => {
    const launched = await launchApp();
    app = launched.app;
    port = launched.port;
    accountId = await resolveAccountId(port);
  }, 120_000);

  afterAll(async () => {
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

  describe("core", () => {
    let launcher: LauncherService;

    beforeAll(async () => {
      launcher = new LauncherService(port);
      await retryAsync(() => launcher.connect(), { retries: 3, delay: 1_000 });
    }, 15_000);

    afterAll(async () => {
      await forceStopInstance(launcher, accountId, port);
      launcher.disconnect();
    }, 30_000);

    it("stops a running instance and handles the closing dialog", async () => {
      // Start the instance
      await startInstanceWithRecovery(launcher, accountId, port);

      // Stop with dialog dismissal — should handle the "Are you sure?"
      // dialog automatically if it appears, or return cleanly if not.
      await launcher.stopInstanceWithDialogDismissal(accountId);

      // After returning, no dialog issues should remain
      const issues = await launcher.getInstanceIssues(accountId);
      const remainingDialogs = issues.filter((i) => i.type === "dialog");
      expect(remainingDialogs).toHaveLength(0);
    }, 120_000);

    it("completes without error on an already-stopped instance", async () => {
      // Call on an instance that is not running — should not throw
      await expect(
        launcher.stopInstanceWithDialogDismissal(accountId),
      ).resolves.toBeUndefined();
    }, 30_000);
  });
});
