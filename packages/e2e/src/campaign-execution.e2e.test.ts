// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { describeE2E, launchApp, quitApp, retryAsync } from "@lhremote/core/testing";
import {
  type Account,
  type AppService,
  killInstanceProcesses,
  LauncherService,
  startInstanceWithRecovery,
  waitForInstanceShutdown,
} from "@lhremote/core";

// CLI handlers
import {
  handleCampaignCreate,
  handleCampaignDelete,
  handleCampaignGet,
  handleCampaignMoveNext,
  handleCampaignRetry,
  handleCampaignStart,
  handleCampaignStatistics,
  handleCampaignStatus,
  handleCampaignStop,
} from "@lhremote/cli/handlers";

// MCP tool registration
import {
  registerCampaignCreate,
  registerCampaignDelete,
  registerCampaignGet,
  registerCampaignMoveNext,
  registerCampaignRetry,
  registerCampaignStart,
  registerCampaignStatistics,
  registerCampaignStatus,
  registerCampaignStop,
} from "@lhremote/mcp/tools";
import { createMockServer } from "@lhremote/mcp/testing";

/** Type-narrowing assertion — fails the test with `message` when `value` is nullish. */
function assertDefined<T>(value: T, message: string): asserts value is NonNullable<T> {
  expect(value, message).toBeDefined();
  expect(value, message).not.toBeNull();
}

/**
 * Campaign config with two actions so campaign-move-next can advance
 * a person from the first action to the second.
 */
const TEST_CAMPAIGN_YAML = `
version: "1"
name: E2E Execution Campaign
description: Created by E2E campaign execution tests
actions:
  - type: VisitAndExtract
  - type: SendConnectionRequest
`.trimStart();

/** Test person LH ID — https://www.linkedin.com/in/ollybriz/ */
const TEST_PERSON_ID = 10996;

/**
 * Stop the instance gracefully, falling back to SIGKILL if that fails.
 */
async function forceStopInstance(
  launcher: LauncherService,
  accountId: number | undefined,
  launcherPort: number,
): Promise<void> {
  if (accountId === undefined) return;

  try {
    await launcher.stopInstance(accountId);
    await waitForInstanceShutdown(launcherPort);
    return;
  } catch {
    // Graceful stop failed — escalate to OS kill
  }

  await killInstanceProcesses(launcherPort);
}

describeE2E("Campaign execution and monitoring", () => {
  let app: AppService;
  let port: number;
  let accountId: number | undefined;

  beforeAll(async () => {
    const launched = await launchApp();
    app = launched.app;
    port = launched.port;

    // Start an account instance — required by execution operations
    const launcher = new LauncherService(port);
    await retryAsync(() => launcher.connect(), { retries: 3, delay: 1_000 });
    const accounts = await launcher.listAccounts();

    if (accounts.length > 0) {
      accountId = (accounts[0] as Account).id;
      await startInstanceWithRecovery(launcher, accountId, port);
    }

    launcher.disconnect();
  }, 120_000);

  afterAll(async () => {
    // Stop the instance before quitting
    if (accountId !== undefined) {
      const launcher = new LauncherService(port);
      try {
        await launcher.connect();
        await forceStopInstance(launcher, accountId, port);
      } catch {
        // Best-effort cleanup
      } finally {
        launcher.disconnect();
      }
    }
    await quitApp(app);
  }, 60_000);

  // -----------------------------------------------------------------------
  // CLI handlers
  // -----------------------------------------------------------------------

  describe("CLI handlers", () => {
    const originalExitCode = process.exitCode;

    /** Campaign ID created during the test — used across sequential steps. */
    let campaignId: number | undefined;

    /** First action ID from the campaign (VisitAndExtract). */
    let firstActionId: number | undefined;

    afterAll(async () => {
      // Cleanup: stop and archive the test campaign if it was created
      if (campaignId !== undefined) {
        try {
          vi.spyOn(process.stdout, "write").mockReturnValue(true);
          try {
            await handleCampaignStop(campaignId, { cdpPort: port });
          } catch {
            // Already stopped — that's fine
          }
          await handleCampaignDelete(campaignId, { cdpPort: port });
        } catch {
          // Best-effort cleanup
        } finally {
          vi.restoreAllMocks();
        }
      }
    });

    beforeEach(() => {
      process.exitCode = undefined;
    });

    afterEach(() => {
      process.exitCode = originalExitCode;
      vi.restoreAllMocks();
    });

    it("campaign-create creates a test campaign with two actions", async () => {
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleCampaignCreate({
        yaml: TEST_CAMPAIGN_YAML,
        cdpPort: port,
        json: true,
      });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      const parsed = JSON.parse(output) as {
        id: number;
        name: string;
        state: string;
      };

      expect(parsed.id).toBeGreaterThan(0);
      campaignId = parsed.id;

      expect(parsed.name).toBe("E2E Execution Campaign");
      expect(parsed.state).toBe("paused");
    }, 30_000);

    it("campaign-get retrieves action IDs for the campaign", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleCampaignGet(campaignId, { cdpPort: port, json: true });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      const parsed = JSON.parse(output) as {
        id: number;
        actions: { id: number; config: { actionType: string } }[];
      };

      expect(parsed.id).toBe(campaignId);
      expect(parsed.actions.length).toBeGreaterThanOrEqual(2);

      const visitAction = parsed.actions.find((a) => a.config.actionType === "VisitAndExtract");
      assertDefined(visitAction, "VisitAndExtract action not found");
      firstActionId = visitAction.id;
    }, 30_000);

    it("campaign-start queues the test person", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleCampaignStart(campaignId, {
        personIds: String(TEST_PERSON_ID),
        cdpPort: port,
        json: true,
      });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      const parsed = JSON.parse(output) as {
        success: boolean;
        campaignId: number;
        personsQueued: number;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.personsQueued).toBeGreaterThanOrEqual(1);
    }, 90_000);

    it("campaign-status returns execution state", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleCampaignStatus(campaignId, { cdpPort: port, json: true });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      const parsed = JSON.parse(output) as {
        campaignId: number;
        campaignState: string;
        isPaused: boolean;
        runnerState: string;
        actionCounts: { actionId: number; queued: number; processed: number; successful: number; failed: number }[];
      };

      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.campaignState).toBeDefined();
      expect(typeof parsed.isPaused).toBe("boolean");
      expect(parsed.runnerState).toBeDefined();
      expect(Array.isArray(parsed.actionCounts)).toBe(true);
    }, 30_000);

    it("campaign-statistics returns statistics structure", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleCampaignStatistics(campaignId, { cdpPort: port, json: true });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      const parsed = JSON.parse(output) as {
        campaignId: number;
        totals: { total: number; successful: number; failed: number; skipped: number; replied: number; successRate: number };
        actions: { actionId: number; actionName: string; actionType: string; total: number }[];
      };

      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.totals).toBeDefined();
      expect(typeof parsed.totals.total).toBe("number");
      expect(Array.isArray(parsed.actions)).toBe(true);
    }, 30_000);

    it("campaign-stop pauses the campaign", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleCampaignStop(campaignId, { cdpPort: port, json: true });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      const parsed = JSON.parse(output) as {
        success: boolean;
        campaignId: number;
        message: string;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.campaignId).toBe(campaignId);
    }, 30_000);

    it("campaign-retry resets the test person for retry", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleCampaignRetry(campaignId, {
        personIds: String(TEST_PERSON_ID),
        cdpPort: port,
        json: true,
      });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      const parsed = JSON.parse(output) as {
        success: boolean;
        campaignId: number;
        personsReset: number;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.campaignId).toBe(campaignId);
      expect(typeof parsed.personsReset).toBe("number");
    }, 30_000);

    it("campaign-move-next advances the test person to the next action", async () => {
      assertDefined(campaignId, "campaign-create must run first");
      assertDefined(firstActionId, "campaign-get must run first");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleCampaignMoveNext(campaignId, firstActionId, {
        personIds: String(TEST_PERSON_ID),
        cdpPort: port,
        json: true,
      });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      const parsed = JSON.parse(output) as {
        success: boolean;
        campaignId: number;
        fromActionId: number;
        toActionId: number;
        personsMoved: number;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.fromActionId).toBe(firstActionId);
      expect(parsed.toActionId).not.toBe(firstActionId);
      expect(typeof parsed.personsMoved).toBe("number");
    }, 30_000);

    it("campaign-delete archives the test campaign", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleCampaignDelete(campaignId, { cdpPort: port, json: true });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      const parsed = JSON.parse(output) as {
        success: boolean;
        campaignId: number;
        action: string;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.action).toBe("archived");

      // Prevent afterAll cleanup from trying again
      campaignId = undefined;
    }, 30_000);
  });

  // -----------------------------------------------------------------------
  // MCP tools
  // -----------------------------------------------------------------------

  describe("MCP tools", () => {
    /** Campaign ID created during the test — used across sequential steps. */
    let campaignId: number | undefined;

    /** First action ID from the campaign (VisitAndExtract). */
    let firstActionId: number | undefined;

    afterAll(async () => {
      // Cleanup: stop and archive the test campaign if it was created
      if (campaignId !== undefined) {
        const { server, getHandler } = createMockServer();
        registerCampaignStop(server);
        registerCampaignDelete(server);
        try {
          try {
            await getHandler("campaign-stop")({ campaignId, cdpPort: port });
          } catch {
            // Already stopped — that's fine
          }
          await getHandler("campaign-delete")({ campaignId, cdpPort: port });
        } catch {
          // Best-effort cleanup
        }
      }
    });

    it("campaign-create tool creates a test campaign with two actions", async () => {
      const { server, getHandler } = createMockServer();
      registerCampaignCreate(server);

      const handler = getHandler("campaign-create");
      const result = (await handler({
        config: TEST_CAMPAIGN_YAML,
        format: "yaml",
        cdpPort: port,
      })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(
        (result.content[0] as { text: string }).text,
      ) as {
        id: number;
        name: string;
        state: string;
      };

      expect(parsed.id).toBeGreaterThan(0);
      campaignId = parsed.id;

      expect(parsed.name).toBe("E2E Execution Campaign");
      expect(parsed.state).toBe("paused");
    }, 30_000);

    it("campaign-get tool retrieves action IDs for the campaign", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const { server, getHandler } = createMockServer();
      registerCampaignGet(server);

      const handler = getHandler("campaign-get");
      const result = (await handler({
        campaignId,
        cdpPort: port,
      })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(
        (result.content[0] as { text: string }).text,
      ) as {
        id: number;
        actions: { id: number; config: { actionType: string } }[];
      };

      expect(parsed.id).toBe(campaignId);
      expect(parsed.actions.length).toBeGreaterThanOrEqual(2);

      const visitAction = parsed.actions.find((a) => a.config.actionType === "VisitAndExtract");
      assertDefined(visitAction, "VisitAndExtract action not found");
      firstActionId = visitAction.id;
    }, 30_000);

    it("campaign-start tool queues the test person", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const { server, getHandler } = createMockServer();
      registerCampaignStart(server);

      const handler = getHandler("campaign-start");
      const result = (await handler({
        campaignId,
        personIds: [TEST_PERSON_ID],
        cdpPort: port,
      })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(
        (result.content[0] as { text: string }).text,
      ) as {
        success: boolean;
        campaignId: number;
        personsQueued: number;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.personsQueued).toBeGreaterThanOrEqual(1);
    }, 90_000);

    it("campaign-status tool returns execution state", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const { server, getHandler } = createMockServer();
      registerCampaignStatus(server);

      const handler = getHandler("campaign-status");
      const result = (await handler({
        campaignId,
        cdpPort: port,
      })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(
        (result.content[0] as { text: string }).text,
      ) as {
        campaignId: number;
        campaignState: string;
        isPaused: boolean;
        runnerState: string;
        actionCounts: { actionId: number; queued: number; processed: number; successful: number; failed: number }[];
      };

      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.campaignState).toBeDefined();
      expect(typeof parsed.isPaused).toBe("boolean");
      expect(parsed.runnerState).toBeDefined();
      expect(Array.isArray(parsed.actionCounts)).toBe(true);
    }, 30_000);

    it("campaign-statistics tool returns statistics structure", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const { server, getHandler } = createMockServer();
      registerCampaignStatistics(server);

      const handler = getHandler("campaign-statistics");
      const result = (await handler({
        campaignId,
        cdpPort: port,
      })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(
        (result.content[0] as { text: string }).text,
      ) as {
        campaignId: number;
        totals: { total: number; successful: number; failed: number; skipped: number; replied: number; successRate: number };
        actions: { actionId: number; actionName: string; actionType: string; total: number }[];
      };

      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.totals).toBeDefined();
      expect(typeof parsed.totals.total).toBe("number");
      expect(Array.isArray(parsed.actions)).toBe(true);
    }, 30_000);

    it("campaign-stop tool pauses the campaign", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const { server, getHandler } = createMockServer();
      registerCampaignStop(server);

      const handler = getHandler("campaign-stop");
      const result = (await handler({
        campaignId,
        cdpPort: port,
      })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(
        (result.content[0] as { text: string }).text,
      ) as {
        success: boolean;
        campaignId: number;
        message: string;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.campaignId).toBe(campaignId);
    }, 30_000);

    it("campaign-retry tool resets the test person for retry", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const { server, getHandler } = createMockServer();
      registerCampaignRetry(server);

      const handler = getHandler("campaign-retry");
      const result = (await handler({
        campaignId,
        personIds: [TEST_PERSON_ID],
        cdpPort: port,
      })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(
        (result.content[0] as { text: string }).text,
      ) as {
        success: boolean;
        campaignId: number;
        personsReset: number;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.campaignId).toBe(campaignId);
      expect(typeof parsed.personsReset).toBe("number");
    }, 30_000);

    it("campaign-move-next tool advances the test person to the next action", async () => {
      assertDefined(campaignId, "campaign-create must run first");
      assertDefined(firstActionId, "campaign-get must run first");

      const { server, getHandler } = createMockServer();
      registerCampaignMoveNext(server);

      const handler = getHandler("campaign-move-next");
      const result = (await handler({
        campaignId,
        actionId: firstActionId,
        personIds: [TEST_PERSON_ID],
        cdpPort: port,
      })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(
        (result.content[0] as { text: string }).text,
      ) as {
        success: boolean;
        campaignId: number;
        fromActionId: number;
        toActionId: number;
        personsMoved: number;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.fromActionId).toBe(firstActionId);
      expect(parsed.toActionId).not.toBe(firstActionId);
      expect(typeof parsed.personsMoved).toBe("number");
    }, 30_000);

    it("campaign-delete tool archives the test campaign", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const { server, getHandler } = createMockServer();
      registerCampaignDelete(server);

      const handler = getHandler("campaign-delete");
      const result = (await handler({
        campaignId,
        cdpPort: port,
      })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(
        (result.content[0] as { text: string }).text,
      ) as {
        success: boolean;
        campaignId: number;
        action: string;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.action).toBe("archived");

      // Prevent afterAll cleanup from trying again
      campaignId = undefined;
    }, 30_000);
  });
});
