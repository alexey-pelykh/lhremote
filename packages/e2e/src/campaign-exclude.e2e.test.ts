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
  handleCampaignExcludeAdd,
  handleCampaignExcludeList,
  handleCampaignExcludeRemove,
  handleCampaignGet,
} from "@lhremote/cli/handlers";

// MCP tool registration
import {
  registerCampaignCreate,
  registerCampaignDelete,
  registerCampaignExcludeAdd,
  registerCampaignExcludeList,
  registerCampaignExcludeRemove,
  registerCampaignGet,
} from "@lhremote/mcp/tools";
import { createMockServer } from "@lhremote/mcp/testing";

/** Type-narrowing assertion — fails the test with `message` when `value` is nullish. */
function assertDefined<T>(value: T, message: string): asserts value is NonNullable<T> {
  expect(value, message).toBeDefined();
  expect(value, message).not.toBeNull();
}

/**
 * Campaign config with two actions so we can test both campaign-level
 * and action-level exclusion.
 */
const TEST_CAMPAIGN_YAML = `
version: "1"
name: E2E Exclude Campaign
description: Created by E2E campaign exclude tests
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

describeE2E("Campaign exclude list", () => {
  let app: AppService;
  let port: number;
  let accountId: number | undefined;

  beforeAll(async () => {
    const launched = await launchApp();
    app = launched.app;
    port = launched.port;

    // Start an account instance — required by exclude operations
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

    /** First action ID (VisitAndExtract) — used for action-level exclusion. */
    let firstActionId: number | undefined;

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

      expect(parsed.name).toBe("E2E Exclude Campaign");
      expect(parsed.state).toBe("paused");
    }, 30_000);

    it("campaign-get retrieves action IDs for action-level exclusion", async () => {
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

    // -- Campaign-level exclusion --

    it("campaign-exclude-add adds a person to the campaign exclude list", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleCampaignExcludeAdd(campaignId, {
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
        level: string;
        added: number;
        alreadyExcluded: number;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.level).toBe("campaign");
      expect(parsed.added).toBe(1);
    }, 30_000);

    it("campaign-exclude-list shows the excluded person at campaign level", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleCampaignExcludeList(campaignId, {
        cdpPort: port,
        json: true,
      });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      const parsed = JSON.parse(output) as {
        campaignId: number;
        level: string;
        count: number;
        personIds: number[];
      };

      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.level).toBe("campaign");
      expect(parsed.count).toBeGreaterThanOrEqual(1);
      expect(parsed.personIds).toContain(TEST_PERSON_ID);
    }, 30_000);

    it("campaign-exclude-remove removes the person from the campaign exclude list", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleCampaignExcludeRemove(campaignId, {
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
        level: string;
        removed: number;
        notInList: number;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.level).toBe("campaign");
      expect(parsed.removed).toBe(1);
    }, 30_000);

    it("campaign-exclude-list confirms campaign exclude list is empty", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleCampaignExcludeList(campaignId, {
        cdpPort: port,
        json: true,
      });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      const parsed = JSON.parse(output) as {
        campaignId: number;
        level: string;
        count: number;
        personIds: number[];
      };

      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.count).toBe(0);
      expect(parsed.personIds).toEqual([]);
    }, 30_000);

    // -- Action-level exclusion --

    it("campaign-exclude-add adds a person to the action exclude list", async () => {
      assertDefined(campaignId, "campaign-create must run first");
      assertDefined(firstActionId, "campaign-get must run first");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleCampaignExcludeAdd(campaignId, {
        personIds: String(TEST_PERSON_ID),
        actionId: firstActionId,
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
        level: string;
        actionId: number;
        added: number;
        alreadyExcluded: number;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.level).toBe("action");
      expect(parsed.actionId).toBe(firstActionId);
      expect(parsed.added).toBe(1);
    }, 30_000);

    it("campaign-exclude-list shows the excluded person at action level", async () => {
      assertDefined(campaignId, "campaign-create must run first");
      assertDefined(firstActionId, "campaign-get must run first");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleCampaignExcludeList(campaignId, {
        actionId: firstActionId,
        cdpPort: port,
        json: true,
      });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      const parsed = JSON.parse(output) as {
        campaignId: number;
        level: string;
        actionId: number;
        count: number;
        personIds: number[];
      };

      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.level).toBe("action");
      expect(parsed.actionId).toBe(firstActionId);
      expect(parsed.count).toBeGreaterThanOrEqual(1);
      expect(parsed.personIds).toContain(TEST_PERSON_ID);
    }, 30_000);

    it("campaign-exclude-remove removes the person from the action exclude list", async () => {
      assertDefined(campaignId, "campaign-create must run first");
      assertDefined(firstActionId, "campaign-get must run first");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleCampaignExcludeRemove(campaignId, {
        personIds: String(TEST_PERSON_ID),
        actionId: firstActionId,
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
        level: string;
        actionId: number;
        removed: number;
        notInList: number;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.level).toBe("action");
      expect(parsed.actionId).toBe(firstActionId);
      expect(parsed.removed).toBe(1);
    }, 30_000);

    it("campaign-exclude-list confirms action exclude list is empty", async () => {
      assertDefined(campaignId, "campaign-create must run first");
      assertDefined(firstActionId, "campaign-get must run first");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleCampaignExcludeList(campaignId, {
        actionId: firstActionId,
        cdpPort: port,
        json: true,
      });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      const parsed = JSON.parse(output) as {
        campaignId: number;
        level: string;
        actionId: number;
        count: number;
        personIds: number[];
      };

      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.actionId).toBe(firstActionId);
      expect(parsed.count).toBe(0);
      expect(parsed.personIds).toEqual([]);
    }, 30_000);

    // -- Cleanup --

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

    /** First action ID (VisitAndExtract) — used for action-level exclusion. */
    let firstActionId: number | undefined;

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

      expect(parsed.name).toBe("E2E Exclude Campaign");
      expect(parsed.state).toBe("paused");
    }, 30_000);

    it("campaign-get tool retrieves action IDs for action-level exclusion", async () => {
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

    // -- Campaign-level exclusion --

    it("campaign-exclude-add tool adds a person to the campaign exclude list", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const { server, getHandler } = createMockServer();
      registerCampaignExcludeAdd(server);

      const handler = getHandler("campaign-exclude-add");
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
        level: string;
        added: number;
        alreadyExcluded: number;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.level).toBe("campaign");
      expect(parsed.added).toBe(1);
    }, 30_000);

    it("campaign-exclude-list tool shows the excluded person at campaign level", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const { server, getHandler } = createMockServer();
      registerCampaignExcludeList(server);

      const handler = getHandler("campaign-exclude-list");
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
        level: string;
        count: number;
        personIds: number[];
      };

      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.level).toBe("campaign");
      expect(parsed.count).toBeGreaterThanOrEqual(1);
      expect(parsed.personIds).toContain(TEST_PERSON_ID);
    }, 30_000);

    it("campaign-exclude-remove tool removes the person from the campaign exclude list", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const { server, getHandler } = createMockServer();
      registerCampaignExcludeRemove(server);

      const handler = getHandler("campaign-exclude-remove");
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
        level: string;
        removed: number;
        notInList: number;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.level).toBe("campaign");
      expect(parsed.removed).toBe(1);
    }, 30_000);

    it("campaign-exclude-list tool confirms campaign exclude list is empty", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const { server, getHandler } = createMockServer();
      registerCampaignExcludeList(server);

      const handler = getHandler("campaign-exclude-list");
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
        level: string;
        count: number;
        personIds: number[];
      };

      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.count).toBe(0);
      expect(parsed.personIds).toEqual([]);
    }, 30_000);

    // -- Action-level exclusion --

    it("campaign-exclude-add tool adds a person to the action exclude list", async () => {
      assertDefined(campaignId, "campaign-create must run first");
      assertDefined(firstActionId, "campaign-get must run first");

      const { server, getHandler } = createMockServer();
      registerCampaignExcludeAdd(server);

      const handler = getHandler("campaign-exclude-add");
      const result = (await handler({
        campaignId,
        personIds: [TEST_PERSON_ID],
        actionId: firstActionId,
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
        level: string;
        actionId: number;
        added: number;
        alreadyExcluded: number;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.level).toBe("action");
      expect(parsed.actionId).toBe(firstActionId);
      expect(parsed.added).toBe(1);
    }, 30_000);

    it("campaign-exclude-list tool shows the excluded person at action level", async () => {
      assertDefined(campaignId, "campaign-create must run first");
      assertDefined(firstActionId, "campaign-get must run first");

      const { server, getHandler } = createMockServer();
      registerCampaignExcludeList(server);

      const handler = getHandler("campaign-exclude-list");
      const result = (await handler({
        campaignId,
        actionId: firstActionId,
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
        level: string;
        actionId: number;
        count: number;
        personIds: number[];
      };

      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.level).toBe("action");
      expect(parsed.actionId).toBe(firstActionId);
      expect(parsed.count).toBeGreaterThanOrEqual(1);
      expect(parsed.personIds).toContain(TEST_PERSON_ID);
    }, 30_000);

    it("campaign-exclude-remove tool removes the person from the action exclude list", async () => {
      assertDefined(campaignId, "campaign-create must run first");
      assertDefined(firstActionId, "campaign-get must run first");

      const { server, getHandler } = createMockServer();
      registerCampaignExcludeRemove(server);

      const handler = getHandler("campaign-exclude-remove");
      const result = (await handler({
        campaignId,
        personIds: [TEST_PERSON_ID],
        actionId: firstActionId,
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
        level: string;
        actionId: number;
        removed: number;
        notInList: number;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.level).toBe("action");
      expect(parsed.actionId).toBe(firstActionId);
      expect(parsed.removed).toBe(1);
    }, 30_000);

    it("campaign-exclude-list tool confirms action exclude list is empty", async () => {
      assertDefined(campaignId, "campaign-create must run first");
      assertDefined(firstActionId, "campaign-get must run first");

      const { server, getHandler } = createMockServer();
      registerCampaignExcludeList(server);

      const handler = getHandler("campaign-exclude-list");
      const result = (await handler({
        campaignId,
        actionId: firstActionId,
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
        level: string;
        actionId: number;
        count: number;
        personIds: number[];
      };

      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.actionId).toBe(firstActionId);
      expect(parsed.count).toBe(0);
      expect(parsed.personIds).toEqual([]);
    }, 30_000);

    // -- Cleanup --

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
