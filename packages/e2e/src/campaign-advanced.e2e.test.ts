// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertDefined, describeE2E, forceStopInstance, installErrorDetection, launchApp, quitApp, resolveAccountId, retryAsync } from "@lhremote/core/testing";
import {
  type AppService,
  LauncherService,
  startInstanceWithRecovery,
} from "@lhremote/core";

// CLI handlers
import {
  handleCampaignCreate,
  handleCampaignErase,
  handleCampaignGet,
  handleCampaignUpdateAction,
} from "@lhremote/cli/handlers";

// MCP tool registration
import {
  registerCampaignCreate,
  registerCampaignErase,
  registerCampaignGet,
  registerCampaignUpdateAction,
} from "@lhremote/mcp/tools";
import { createMockServer } from "@lhremote/mcp/testing";

/**
 * Campaign config with one action so we have an action to update.
 */
const TEST_CAMPAIGN_YAML = `
version: "1"
name: E2E Campaign Advanced
description: Created by E2E campaign advanced tests
actions:
  - type: VisitAndExtract
`.trimStart();

describeE2E("Campaign advanced operations", () => {
  let app: AppService;
  let port: number;
  let accountId: number;

  beforeAll(async () => {
    const launched = await launchApp();
    app = launched.app;
    port = launched.port;

    // Start an account instance — required by campaign operations
    accountId = await resolveAccountId(port);

    const launcher = new LauncherService(port);
    await retryAsync(() => launcher.connect(), { retries: 3, delay: 1_000 });
    await startInstanceWithRecovery(launcher, accountId, port);
    launcher.disconnect();
  }, 120_000);

  afterAll(async () => {
    // Stop the instance before quitting
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

  installErrorDetection(() => port);

  // -----------------------------------------------------------------------
  // CLI handlers
  // -----------------------------------------------------------------------

  describe("CLI handlers", () => {
    const originalExitCode = process.exitCode;

    /** Campaign ID created during the test — used across sequential steps. */
    let campaignId: number | undefined;

    /** Action ID from the action created via YAML. */
    let actionId: number | undefined;

    afterAll(async () => {
      // Cleanup: permanently erase the test campaign if it was not already erased
      if (campaignId !== undefined) {
        const previousExitCode = process.exitCode;
        try {
          process.exitCode = undefined;
          vi.spyOn(process.stdout, "write").mockReturnValue(true);
          await handleCampaignErase(campaignId, { cdpPort: port });
        } catch {
          // Best-effort cleanup
        } finally {
          process.exitCode = previousExitCode;
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

    it("campaign-create creates a test campaign with one action", async () => {
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

      expect(parsed.name).toBe("E2E Campaign Advanced");
      expect(parsed.state).toBe("paused");
    }, 30_000);

    it("campaign-get retrieves the action created with the campaign", async () => {
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
      expect(parsed.actions.length).toBeGreaterThanOrEqual(1);

      const visitAction = parsed.actions.find((a) => a.config.actionType === "VisitAndExtract");
      assertDefined(visitAction, "VisitAndExtract action not found");

      actionId = visitAction.id;
    }, 30_000);

    it("campaign-update-action updates the action name", async () => {
      assertDefined(campaignId, "campaign-create must run first");
      assertDefined(actionId, "campaign-get must run first");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleCampaignUpdateAction(campaignId, actionId, {
        name: "Updated Visit Action",
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
      };

      expect(parsed.id).toBe(actionId);
      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.name).toBe("Updated Visit Action");
    }, 30_000);

    it("campaign-update-action updates coolDown and maxResults", async () => {
      assertDefined(campaignId, "campaign-create must run first");
      assertDefined(actionId, "campaign-get must run first");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleCampaignUpdateAction(campaignId, actionId, {
        coolDown: 5000,
        maxResults: 10,
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
        config: {
          coolDown: number;
          maxActionResultsPerIteration: number;
        };
      };

      expect(parsed.id).toBe(actionId);
      expect(parsed.config.coolDown).toBe(5000);
      expect(parsed.config.maxActionResultsPerIteration).toBe(10);
    }, 30_000);

    it("campaign-erase permanently deletes the campaign", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleCampaignErase(campaignId, { cdpPort: port, json: true });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      const parsed = JSON.parse(output) as {
        success: boolean;
        campaignId: number;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.campaignId).toBe(campaignId);

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

    /** Action ID from the action created via YAML. */
    let actionId: number | undefined;

    afterAll(async () => {
      // Cleanup: permanently erase the test campaign if it was not already erased
      if (campaignId !== undefined) {
        const { server, getHandler } = createMockServer();
        registerCampaignErase(server);
        try {
          await getHandler("campaign-erase")({ campaignId, cdpPort: port });
        } catch {
          // Best-effort cleanup
        }
      }
    });

    it("campaign-create tool creates a test campaign with one action", async () => {
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

      expect(result.isError, `MCP tool error: ${result.content?.[0]?.text}`).toBeUndefined();
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

      expect(parsed.name).toBe("E2E Campaign Advanced");
      expect(parsed.state).toBe("paused");
    }, 30_000);

    it("campaign-get tool retrieves the action created with the campaign", async () => {
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

      expect(result.isError, `MCP tool error: ${result.content?.[0]?.text}`).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(
        (result.content[0] as { text: string }).text,
      ) as {
        id: number;
        actions: { id: number; config: { actionType: string } }[];
      };

      expect(parsed.id).toBe(campaignId);
      expect(parsed.actions.length).toBeGreaterThanOrEqual(1);

      const visitAction = parsed.actions.find((a) => a.config.actionType === "VisitAndExtract");
      assertDefined(visitAction, "VisitAndExtract action not found");

      actionId = visitAction.id;
    }, 30_000);

    it("campaign-update-action tool updates the action name", async () => {
      assertDefined(campaignId, "campaign-create must run first");
      assertDefined(actionId, "campaign-get must run first");

      const { server, getHandler } = createMockServer();
      registerCampaignUpdateAction(server);

      const handler = getHandler("campaign-update-action");
      const result = (await handler({
        campaignId,
        actionId,
        name: "Updated Visit Action",
        cdpPort: port,
      })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(result.isError, `MCP tool error: ${result.content?.[0]?.text}`).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(
        (result.content[0] as { text: string }).text,
      ) as {
        id: number;
        campaignId: number;
        name: string;
      };

      expect(parsed.id).toBe(actionId);
      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.name).toBe("Updated Visit Action");
    }, 30_000);

    it("campaign-update-action tool updates coolDown and maxResults", async () => {
      assertDefined(campaignId, "campaign-create must run first");
      assertDefined(actionId, "campaign-get must run first");

      const { server, getHandler } = createMockServer();
      registerCampaignUpdateAction(server);

      const handler = getHandler("campaign-update-action");
      const result = (await handler({
        campaignId,
        actionId,
        coolDown: 5000,
        maxActionResultsPerIteration: 10,
        cdpPort: port,
      })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(result.isError, `MCP tool error: ${result.content?.[0]?.text}`).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(
        (result.content[0] as { text: string }).text,
      ) as {
        id: number;
        config: {
          coolDown: number;
          maxActionResultsPerIteration: number;
        };
      };

      expect(parsed.id).toBe(actionId);
      expect(parsed.config.coolDown).toBe(5000);
      expect(parsed.config.maxActionResultsPerIteration).toBe(10);
    }, 30_000);

    it("campaign-erase tool permanently deletes the campaign", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const { server, getHandler } = createMockServer();
      registerCampaignErase(server);

      const handler = getHandler("campaign-erase");
      const result = (await handler({
        campaignId,
        cdpPort: port,
      })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(result.isError, `MCP tool error: ${result.content?.[0]?.text}`).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(
        (result.content[0] as { text: string }).text,
      ) as {
        success: boolean;
        campaignId: number;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.campaignId).toBe(campaignId);

      // Prevent afterAll cleanup from trying again
      campaignId = undefined;
    }, 30_000);
  });
});
