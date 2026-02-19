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
  handleCampaignAddAction,
  handleCampaignCreate,
  handleCampaignDelete,
  handleCampaignGet,
  handleCampaignRemoveAction,
  handleCampaignReorderActions,
} from "@lhremote/cli/handlers";

// MCP tool registration
import {
  registerCampaignAddAction,
  registerCampaignCreate,
  registerCampaignDelete,
  registerCampaignGet,
  registerCampaignRemoveAction,
  registerCampaignReorderActions,
} from "@lhremote/mcp/tools";
import { createMockServer } from "@lhremote/mcp/testing";

/** Type-narrowing assertion — fails the test with `message` when `value` is nullish. */
function assertDefined<T>(value: T, message: string): asserts value is NonNullable<T> {
  expect(value, message).toBeDefined();
  expect(value, message).not.toBeNull();
}

/**
 * Campaign config with two actions so the LH instance tracks them in its
 * campaign version (required for reorder operations).
 */
const TEST_CAMPAIGN_YAML = `
version: "1"
name: E2E Action Management Campaign
description: Created by E2E campaign action management tests
actions:
  - type: VisitAndExtract
  - type: SendConnectionRequest
`.trimStart();

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

describeE2E("Campaign action management", () => {
  let app: AppService;
  let port: number;
  let accountId: number | undefined;

  beforeAll(async () => {
    const launched = await launchApp();
    app = launched.app;
    port = launched.port;

    // Start an account instance — required by remove/reorder operations
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

    /** Action IDs from the two actions created via YAML (instance-tracked). */
    let firstActionId: number | undefined;
    let secondActionId: number | undefined;

    /** Action ID added via campaign-add-action (DB-only). */
    let addedActionId: number | undefined;

    afterAll(async () => {
      // Cleanup: archive the test campaign if it was created but not deleted
      if (campaignId !== undefined) {
        try {
          vi.spyOn(process.stdout, "write").mockReturnValue(true);
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

      expect(parsed.name).toBe("E2E Action Management Campaign");
      expect(parsed.state).toBe("paused");
    }, 30_000);

    it("campaign-get retrieves actions created with the campaign", async () => {
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

      // Capture the action IDs from the campaign creation
      const visitAction = parsed.actions.find((a) => a.config.actionType === "VisitAndExtract");
      const connectAction = parsed.actions.find((a) => a.config.actionType === "SendConnectionRequest");
      assertDefined(visitAction, "VisitAndExtract action not found");
      assertDefined(connectAction, "SendConnectionRequest action not found");

      firstActionId = visitAction.id;
      secondActionId = connectAction.id;
    }, 30_000);

    it("campaign-add-action adds a third action", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleCampaignAddAction(campaignId, {
        name: "E2E Added Action",
        actionType: "VisitAndExtract",
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
        campaignId: number;
        name: string;
        config: { actionType: string };
      };

      expect(parsed.id).toBeGreaterThan(0);
      addedActionId = parsed.id;

      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.name).toBe("E2E Added Action");
      expect(parsed.config.actionType).toBe("VisitAndExtract");
    }, 30_000);

    it("campaign-reorder-actions swaps the two initial actions", async () => {
      assertDefined(campaignId, "campaign-create must run first");
      assertDefined(firstActionId, "campaign-get must run first");
      assertDefined(secondActionId, "campaign-get must run first");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      // Reorder: put secondActionId before firstActionId
      await handleCampaignReorderActions(campaignId, {
        actionIds: `${String(secondActionId)},${String(firstActionId)}`,
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
        actions: { id: number; name: string; config: { actionType: string } }[];
      };

      expect(parsed.success).toBe(true);
      expect(parsed.campaignId).toBe(campaignId);

      // Verify the response contains both actions (DB returns ORDER BY id,
      // not chain order, so we only check presence — not position)
      expect(parsed.actions.length).toBeGreaterThanOrEqual(2);
      const actionIds = parsed.actions.map((a) => a.id);
      expect(actionIds).toContain(firstActionId);
      expect(actionIds).toContain(secondActionId);
    }, 30_000);

    it("campaign-remove-action removes the added action", async () => {
      assertDefined(campaignId, "campaign-create must run first");
      assertDefined(addedActionId, "campaign-add-action must run first");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleCampaignRemoveAction(campaignId, addedActionId, {
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
        removedActionId: number;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.removedActionId).toBe(addedActionId);
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

    /** Action IDs from the two actions created via YAML (instance-tracked). */
    let firstActionId: number | undefined;
    let secondActionId: number | undefined;

    /** Action ID added via campaign-add-action (DB-only). */
    let addedActionId: number | undefined;

    afterAll(async () => {
      // Cleanup: archive the test campaign if it was created but not deleted
      if (campaignId !== undefined) {
        const { server, getHandler } = createMockServer();
        registerCampaignDelete(server);
        try {
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

      expect(parsed.name).toBe("E2E Action Management Campaign");
      expect(parsed.state).toBe("paused");
    }, 30_000);

    it("campaign-get tool retrieves actions created with the campaign", async () => {
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

      // Capture the action IDs from the campaign creation
      const visitAction = parsed.actions.find((a) => a.config.actionType === "VisitAndExtract");
      const connectAction = parsed.actions.find((a) => a.config.actionType === "SendConnectionRequest");
      assertDefined(visitAction, "VisitAndExtract action not found");
      assertDefined(connectAction, "SendConnectionRequest action not found");

      firstActionId = visitAction.id;
      secondActionId = connectAction.id;
    }, 30_000);

    it("campaign-add-action tool adds a third action", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const { server, getHandler } = createMockServer();
      registerCampaignAddAction(server);

      const handler = getHandler("campaign-add-action");
      const result = (await handler({
        campaignId,
        name: "E2E Added Action",
        actionType: "VisitAndExtract",
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
        campaignId: number;
        name: string;
        config: { actionType: string };
      };

      expect(parsed.id).toBeGreaterThan(0);
      addedActionId = parsed.id;

      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.name).toBe("E2E Added Action");
      expect(parsed.config.actionType).toBe("VisitAndExtract");
    }, 30_000);

    it("campaign-reorder-actions tool swaps the two initial actions", async () => {
      assertDefined(campaignId, "campaign-create must run first");
      assertDefined(firstActionId, "campaign-get must run first");
      assertDefined(secondActionId, "campaign-get must run first");

      const { server, getHandler } = createMockServer();
      registerCampaignReorderActions(server);

      const handler = getHandler("campaign-reorder-actions");
      const result = (await handler({
        campaignId,
        actionIds: [secondActionId, firstActionId],
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
        actions: { id: number; name: string; config: { actionType: string } }[];
      };

      expect(parsed.success).toBe(true);
      expect(parsed.campaignId).toBe(campaignId);

      // Verify the response contains both actions (DB returns ORDER BY id,
      // not chain order, so we only check presence — not position)
      expect(parsed.actions.length).toBeGreaterThanOrEqual(2);
      const actionIds = parsed.actions.map((a) => a.id);
      expect(actionIds).toContain(firstActionId);
      expect(actionIds).toContain(secondActionId);
    }, 30_000);

    it("campaign-remove-action tool removes the added action", async () => {
      assertDefined(campaignId, "campaign-create must run first");
      assertDefined(addedActionId, "campaign-add-action must run first");

      const { server, getHandler } = createMockServer();
      registerCampaignRemoveAction(server);

      const handler = getHandler("campaign-remove-action");
      const result = (await handler({
        campaignId,
        actionId: addedActionId,
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
        removedActionId: number;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.removedActionId).toBe(addedActionId);
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
