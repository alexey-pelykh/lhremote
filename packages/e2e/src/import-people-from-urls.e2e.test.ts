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
  handleImportPeopleFromUrls,
} from "@lhremote/cli/handlers";

// MCP tool registration
import {
  registerCampaignCreate,
  registerCampaignDelete,
  registerImportPeopleFromUrls,
} from "@lhremote/mcp/tools";
import { createMockServer } from "@lhremote/mcp/testing";

/** Type-narrowing assertion — fails the test with `message` when `value` is nullish. */
function assertDefined<T>(value: T, message: string): asserts value is NonNullable<T> {
  expect(value, message).toBeDefined();
  expect(value, message).not.toBeNull();
}

/** Minimal campaign config for import tests — needs at least one action. */
const TEST_CAMPAIGN_YAML = `
version: "1"
name: E2E Import People Campaign
description: Created by E2E import-people-from-urls tests
actions:
  - type: VisitAndExtract
`.trimStart();

/** Test person LinkedIn URL — https://www.linkedin.com/in/ollybriz/ */
const TEST_URL = "https://www.linkedin.com/in/ollybriz/";

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

describeE2E("import-people-from-urls operation", () => {
  let app: AppService;
  let port: number;
  let accountId: number | undefined;

  beforeAll(async () => {
    const launched = await launchApp();
    app = launched.app;
    port = launched.port;

    // Start an account instance — required by import operations
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

      expect(parsed.name).toBe("E2E Import People Campaign");
      expect(parsed.state).toBe("paused");
    }, 30_000);

    it("import-people-from-urls --json imports a person", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleImportPeopleFromUrls(campaignId, {
        urls: TEST_URL,
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
        actionId: number;
        imported: number;
        alreadyInQueue: number;
        alreadyProcessed: number;
        failed: number;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.actionId).toBeGreaterThan(0);
      expect(parsed.imported).toBe(1);
      expect(parsed.alreadyInQueue).toBe(0);
      expect(parsed.failed ?? 0).toBe(0);
    }, 30_000);

    it("import-people-from-urls re-import shows alreadyInQueue (idempotency)", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleImportPeopleFromUrls(campaignId, {
        urls: TEST_URL,
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
        imported: number;
        alreadyInQueue: number;
        failed: number;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.imported).toBe(0);
      expect(parsed.alreadyInQueue).toBe(1);
      expect(parsed.failed ?? 0).toBe(0);
    }, 30_000);

    it("import-people-from-urls prints human-friendly output", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleImportPeopleFromUrls(campaignId, {
        urls: TEST_URL,
        cdpPort: port,
      });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      expect(output).toContain("Imported");
      expect(output).toContain("already in queue");
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

      expect(parsed.name).toBe("E2E Import People Campaign");
      expect(parsed.state).toBe("paused");
    }, 30_000);

    it("import-people-from-urls tool imports a person", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const { server, getHandler } = createMockServer();
      registerImportPeopleFromUrls(server);

      const handler = getHandler("import-people-from-urls");
      const result = (await handler({
        campaignId,
        linkedInUrls: [TEST_URL],
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
        actionId: number;
        imported: number;
        alreadyInQueue: number;
        alreadyProcessed: number;
        failed: number;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.actionId).toBeGreaterThan(0);
      expect(parsed.imported).toBe(1);
      expect(parsed.alreadyInQueue).toBe(0);
      expect(parsed.failed ?? 0).toBe(0);
    }, 30_000);

    it("import-people-from-urls tool re-import shows alreadyInQueue (idempotency)", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const { server, getHandler } = createMockServer();
      registerImportPeopleFromUrls(server);

      const handler = getHandler("import-people-from-urls");
      const result = (await handler({
        campaignId,
        linkedInUrls: [TEST_URL],
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
        imported: number;
        alreadyInQueue: number;
        failed: number;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.imported).toBe(0);
      expect(parsed.alreadyInQueue).toBe(1);
      expect(parsed.failed ?? 0).toBe(0);
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
