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
  type InstanceIssue,
  LauncherService,
  startInstanceWithRecovery,
} from "@lhremote/core";

describeE2E("dismissInstanceDialog", () => {
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

    it("does not hang when called with a non-existent dialogId", async () => {
      // AC2: calling with a non-existent dialogId should complete without hanging.
      // This verifies the CDP call resolves even when no dialog matches.
      await expect(
        launcher.dismissInstanceDialog(accountId, "non-existent-dialog", "btn-ok"),
      ).resolves.toBeUndefined();
    }, 30_000);

    it("dismisses a closing dialog after stopInstance when one appears", async () => {
      // Start the instance
      await startInstanceWithRecovery(launcher, accountId, port);

      // Stop the instance — may or may not trigger a closing dialog
      await launcher.stopInstance(accountId);

      // Poll for the dialog issue to appear (dialog is not guaranteed)
      let dialogIssue: InstanceIssue | undefined;
      for (let attempt = 0; attempt < 40; attempt++) {
        const issues = await launcher.getInstanceIssues(accountId);
        dialogIssue = issues.find((i) => i.type === "dialog");
        if (dialogIssue) break;
        await new Promise((r) => setTimeout(r, 500));
      }

      // The closing dialog does not appear deterministically — it depends
      // on internal LH instance state and timing.  When absent, we verify
      // the instance stopped without a dialog (still a valid outcome).
      if (!dialogIssue) {
        const issues = await launcher.getInstanceIssues(accountId);
        expect(issues.filter((i) => i.type === "dialog")).toHaveLength(0);
        console.log("  no closing dialog appeared — instance closed cleanly");
        return;
      }

      expect(dialogIssue.type).toBe("dialog");
      expect(dialogIssue.data.options.controls.length).toBeGreaterThan(0);

      const dialogId = dialogIssue.id;
      const firstControl = dialogIssue.data.options.controls[0];
      expect(firstControl).toBeDefined();
      const buttonId = firstControl.id;

      // Dismiss the dialog
      await launcher.dismissInstanceDialog(accountId, dialogId, buttonId);

      // Verify dialog was dismissed — issues should no longer contain it
      const issuesAfter = await launcher.getInstanceIssues(accountId);
      const stillPresent = issuesAfter.find((i) => i.id === dialogId);
      expect(stillPresent).toBeUndefined();
    }, 120_000);
  });
});
