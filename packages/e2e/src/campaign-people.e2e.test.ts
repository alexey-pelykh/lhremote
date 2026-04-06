// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertDefined, describeE2E, forceStopInstance, getE2EPersonId, launchApp, quitApp, resolveAccountId, retryAsync } from "@lhremote/core/testing";
import {
  type AppService,
  LauncherService,
  startInstanceWithRecovery,
} from "@lhremote/core";

// CLI handlers
import {
  handleCampaignCreate,
  handleCampaignErase,
  handleCampaignListPeople,
  handleCampaignRemovePeople,
  handleImportPeopleFromUrls,
} from "@lhremote/cli/handlers";

// MCP tool registration
import {
  registerCampaignCreate,
  registerCampaignErase,
  registerCampaignListPeople,
  registerCampaignRemovePeople,
  registerImportPeopleFromUrls,
} from "@lhremote/mcp/tools";
import { createMockServer } from "@lhremote/mcp/testing";

/** Minimal campaign config for people management tests. */
const TEST_CAMPAIGN_YAML = `
version: "1"
name: E2E Campaign People
description: Created by E2E campaign-people tests
actions:
  - type: VisitAndExtract
`.trimStart();

/** Test person LinkedIn URL — https://www.linkedin.com/in/ollybriz/ */
const TEST_URL = "https://www.linkedin.com/in/ollybriz/";

describeE2E("Campaign people management", () => {
  let app: AppService;
  let port: number;
  let accountId: number;

  /** Person ID from the environment — used to verify list output and remove. */
  const personId = getE2EPersonId();

  beforeAll(async () => {
    const launched = await launchApp();
    app = launched.app;
    port = launched.port;

    accountId = await resolveAccountId(port);

    // Start an account instance — required by campaign-remove-people
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

  // -----------------------------------------------------------------------
  // CLI handlers
  // -----------------------------------------------------------------------

  describe("CLI handlers", () => {
    const originalExitCode = process.exitCode;

    /** Campaign ID created during the test — used across sequential steps. */
    let campaignId: number | undefined;

    afterAll(async () => {
      // Cleanup: permanently erase the test campaign
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

    it("campaign-create creates a test campaign", async () => {
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

      expect(parsed.name).toBe("E2E Campaign People");
      expect(parsed.state).toBe("paused");
    }, 30_000);

    it("import-people-from-urls imports a person into the campaign", async () => {
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
      };

      expect(parsed.success).toBe(true);
      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.imported).toBe(1);
    }, 30_000);

    it("campaign-list-people --json lists imported people", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleCampaignListPeople(campaignId, {
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
        people: {
          personId: number;
          firstName: string;
          lastName: string | null;
          publicId: string | null;
          status: string;
          currentActionId: number;
        }[];
        total: number;
        limit: number;
        offset: number;
      };

      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.total).toBeGreaterThanOrEqual(1);
      expect(parsed.people.length).toBeGreaterThanOrEqual(1);

      const person = parsed.people.find((p) => p.personId === personId);
      assertDefined(person, `person ${String(personId)} not found in list`);
      expect(person.status).toBe("queued");
      expect(person.currentActionId).toBeGreaterThan(0);
    }, 30_000);

    it("campaign-list-people prints human-friendly output", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleCampaignListPeople(campaignId, {
        cdpPort: port,
      });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      expect(output).toContain("People");
      expect(output).toContain("queued");
    }, 30_000);

    it("campaign-remove-people --json removes the imported person", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleCampaignRemovePeople(campaignId, {
        personIds: String(personId),
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
        removed: number;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.actionId).toBeGreaterThan(0);
      expect(parsed.removed).toBe(1);
    }, 30_000);

    it("campaign-list-people --json returns valid data after removal", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleCampaignListPeople(campaignId, {
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
        people: { personId: number }[];
        total: number;
      };

      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.total).toBeGreaterThanOrEqual(0);
    }, 30_000);
  });

  // -----------------------------------------------------------------------
  // MCP tools
  // -----------------------------------------------------------------------

  describe("MCP tools", () => {
    /** Campaign ID created during the test — used across sequential steps. */
    let campaignId: number | undefined;

    afterAll(async () => {
      // Cleanup: permanently erase the test campaign
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

    it("campaign-create tool creates a test campaign", async () => {
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

      expect(parsed.name).toBe("E2E Campaign People");
      expect(parsed.state).toBe("paused");
    }, 30_000);

    it("import-people-from-urls tool imports a person into the campaign", async () => {
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

      expect(result.isError, `MCP tool error: ${result.content?.[0]?.text}`).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(
        (result.content[0] as { text: string }).text,
      ) as {
        success: boolean;
        campaignId: number;
        imported: number;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.imported).toBe(1);
    }, 30_000);

    it("campaign-list-people tool lists imported people", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const { server, getHandler } = createMockServer();
      registerCampaignListPeople(server);

      const handler = getHandler("campaign-list-people");
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
        campaignId: number;
        people: {
          personId: number;
          firstName: string;
          lastName: string | null;
          publicId: string | null;
          status: string;
          currentActionId: number;
        }[];
        total: number;
        limit: number;
        offset: number;
      };

      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.total).toBeGreaterThanOrEqual(1);
      expect(parsed.people.length).toBeGreaterThanOrEqual(1);

      const person = parsed.people.find((p) => p.personId === personId);
      assertDefined(person, `person ${String(personId)} not found in list`);
      expect(person.status).toBe("queued");
      expect(person.currentActionId).toBeGreaterThan(0);
    }, 30_000);

    it("campaign-remove-people tool removes the imported person", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const { server, getHandler } = createMockServer();
      registerCampaignRemovePeople(server);

      const handler = getHandler("campaign-remove-people");
      const result = (await handler({
        campaignId,
        personIds: [personId],
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
        actionId: number;
        removed: number;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.actionId).toBeGreaterThan(0);
      expect(parsed.removed).toBe(1);
    }, 30_000);

    it("campaign-list-people tool returns valid data after removal", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const { server, getHandler } = createMockServer();
      registerCampaignListPeople(server);

      const handler = getHandler("campaign-list-people");
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
        campaignId: number;
        people: { personId: number }[];
        total: number;
      };

      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.total).toBeGreaterThanOrEqual(0);
    }, 30_000);
  });
});
