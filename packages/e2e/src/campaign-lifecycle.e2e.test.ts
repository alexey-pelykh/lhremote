// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { describeE2E, launchApp, quitApp } from "@lhremote/core/testing";
import type { AppService } from "@lhremote/core";
import { parse as parseYaml } from "yaml";

// CLI handlers
import {
  handleCampaignCreate,
  handleCampaignDelete,
  handleCampaignExport,
  handleCampaignGet,
  handleCampaignList,
  handleCampaignUpdate,
} from "@lhremote/cli/handlers";

// MCP tool registration
import {
  registerCampaignCreate,
  registerCampaignDelete,
  registerCampaignExport,
  registerCampaignGet,
  registerCampaignList,
  registerCampaignUpdate,
} from "@lhremote/mcp/tools";
import { createMockServer } from "@lhremote/mcp/testing";

/** Type-narrowing assertion — fails the test with `message` when `value` is nullish. */
function assertDefined<T>(value: T, message: string): asserts value is NonNullable<T> {
  expect(value, message).toBeDefined();
  expect(value, message).not.toBeNull();
}

/** Minimal campaign config for E2E tests. */
const TEST_CAMPAIGN_YAML = `
version: "1"
name: E2E Test Campaign
description: Created by E2E campaign lifecycle tests
actions:
  - type: VisitAndExtract
`.trimStart();

const UPDATED_NAME = "E2E Test Campaign (Updated)";

describeE2E("Campaign CRUD lifecycle", () => {
  let app: AppService;
  let port: number;

  beforeAll(async () => {
    const launched = await launchApp();
    app = launched.app;
    port = launched.port;
  }, 60_000);

  afterAll(async () => {
    await quitApp(app);
  }, 30_000);

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

    it("campaign-create creates a campaign from YAML", async () => {
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
        description: string | null;
        state: string;
        isPaused: boolean;
        isArchived: boolean;
      };

      expect(parsed.name).toBe("E2E Test Campaign");
      expect(parsed.description).toBe("Created by E2E campaign lifecycle tests");
      expect(parsed.state).toBe("active");
      expect(parsed.isPaused).toBe(true);
      expect(parsed.isArchived).toBe(false);
      expect(parsed.id).toBeGreaterThan(0);

      campaignId = parsed.id;
    }, 30_000);

    it("campaign-get retrieves the created campaign", async () => {
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
        name: string;
        actions: { config: { actionType: string } }[];
      };

      expect(parsed.id).toBe(campaignId);
      expect(parsed.name).toBe("E2E Test Campaign");
      expect(parsed.actions.length).toBeGreaterThan(0);
      expect(parsed.actions[0]?.config.actionType).toBe("VisitAndExtract");
    }, 30_000);

    it("campaign-list includes the created campaign", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleCampaignList({ json: true });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      const parsed = JSON.parse(output) as {
        campaigns: { id: number; name: string; state: string }[];
        total: number;
      };

      const found = parsed.campaigns.find((c) => c.id === campaignId);
      assertDefined(found, `Campaign #${String(campaignId)} not found in list`);
      expect(found.name).toBe("E2E Test Campaign");
      expect(found.state).toBe("active");
    });

    it("campaign-update renames the campaign", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleCampaignUpdate(campaignId, {
        name: UPDATED_NAME,
        cdpPort: port,
        json: true,
      });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      const parsed = JSON.parse(output) as { id: number; name: string };

      expect(parsed.id).toBe(campaignId);
      expect(parsed.name).toBe(UPDATED_NAME);
    }, 30_000);

    it("campaign-export exports as YAML", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleCampaignExport(campaignId, {
        format: "yaml",
        cdpPort: port,
      });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");

      // YAML should be parseable
      const parsed = parseYaml(output) as {
        version: string;
        name: string;
        actions: { type: string }[];
      };
      expect(parsed.version).toBe("1");
      expect(parsed.name).toBe(UPDATED_NAME);
      expect(parsed.actions.length).toBeGreaterThan(0);
      expect(parsed.actions[0]?.type).toBe("VisitAndExtract");
    }, 30_000);

    it("campaign-export exports as JSON", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleCampaignExport(campaignId, {
        format: "json",
        cdpPort: port,
      });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");

      // JSON should be parseable
      const parsed = JSON.parse(output) as {
        version: string;
        name: string;
        actions: { type: string }[];
      };
      expect(parsed.version).toBe("1");
      expect(parsed.name).toBe(UPDATED_NAME);
      expect(parsed.actions.length).toBeGreaterThan(0);
      expect(parsed.actions[0]?.type).toBe("VisitAndExtract");
    }, 30_000);

    it("campaign-delete archives the campaign", async () => {
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

    it("campaign-list excludes archived campaign by default", async () => {
      // campaignId was cleared by the delete test, but we still know the ID
      // from the parsed output. Use the list to verify absence.
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleCampaignList({ json: true });

      expect(process.exitCode).toBeUndefined();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      const parsed = JSON.parse(output) as {
        campaigns: { id: number; name: string }[];
      };

      // Archived campaign should not appear in default listing
      const found = parsed.campaigns.find((c) => c.name === UPDATED_NAME);
      expect(found).toBeUndefined();
    });
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

    it("campaign-create tool creates a campaign from YAML", async () => {
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
        description: string | null;
        state: string;
        isPaused: boolean;
        isArchived: boolean;
      };

      expect(parsed.name).toBe("E2E Test Campaign");
      expect(parsed.description).toBe("Created by E2E campaign lifecycle tests");
      expect(parsed.state).toBe("active");
      expect(parsed.isPaused).toBe(true);
      expect(parsed.isArchived).toBe(false);
      expect(parsed.id).toBeGreaterThan(0);

      campaignId = parsed.id;
    }, 30_000);

    it("campaign-get tool retrieves the created campaign", async () => {
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
        name: string;
        actions: { config: { actionType: string } }[];
      };

      expect(parsed.id).toBe(campaignId);
      expect(parsed.name).toBe("E2E Test Campaign");
      expect(parsed.actions.length).toBeGreaterThan(0);
      expect(parsed.actions[0]?.config.actionType).toBe("VisitAndExtract");
    }, 30_000);

    it("campaign-list tool includes the created campaign", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const { server, getHandler } = createMockServer();
      registerCampaignList(server);

      const handler = getHandler("campaign-list");
      const result = (await handler({
        includeArchived: false,
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
        campaigns: { id: number; name: string; state: string }[];
        total: number;
      };

      const found = parsed.campaigns.find((c) => c.id === campaignId);
      assertDefined(found, `Campaign #${String(campaignId)} not found in MCP list`);
      expect(found.name).toBe("E2E Test Campaign");
      expect(found.state).toBe("active");
    }, 30_000);

    it("campaign-update tool renames the campaign", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const { server, getHandler } = createMockServer();
      registerCampaignUpdate(server);

      const handler = getHandler("campaign-update");
      const result = (await handler({
        campaignId,
        name: UPDATED_NAME,
        cdpPort: port,
      })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(
        (result.content[0] as { text: string }).text,
      ) as { id: number; name: string };

      expect(parsed.id).toBe(campaignId);
      expect(parsed.name).toBe(UPDATED_NAME);
    }, 30_000);

    it("campaign-export tool exports as YAML", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const { server, getHandler } = createMockServer();
      registerCampaignExport(server);

      const handler = getHandler("campaign-export");
      const result = (await handler({
        campaignId,
        format: "yaml",
        cdpPort: port,
      })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const wrapper = JSON.parse(
        (result.content[0] as { text: string }).text,
      ) as {
        campaignId: number;
        format: string;
        config: string;
      };

      expect(wrapper.campaignId).toBe(campaignId);
      expect(wrapper.format).toBe("yaml");

      // The config string should be parseable YAML
      const parsed = parseYaml(wrapper.config) as {
        version: string;
        name: string;
        actions: { type: string }[];
      };
      expect(parsed.version).toBe("1");
      expect(parsed.name).toBe(UPDATED_NAME);
      expect(parsed.actions.length).toBeGreaterThan(0);
      expect(parsed.actions[0]?.type).toBe("VisitAndExtract");
    }, 30_000);

    it("campaign-export tool exports as JSON", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      const { server, getHandler } = createMockServer();
      registerCampaignExport(server);

      const handler = getHandler("campaign-export");
      const result = (await handler({
        campaignId,
        format: "json",
        cdpPort: port,
      })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const wrapper = JSON.parse(
        (result.content[0] as { text: string }).text,
      ) as {
        campaignId: number;
        format: string;
        config: string;
      };

      expect(wrapper.campaignId).toBe(campaignId);
      expect(wrapper.format).toBe("json");

      // The config string should be parseable JSON
      const parsed = JSON.parse(wrapper.config) as {
        version: string;
        name: string;
        actions: { type: string }[];
      };
      expect(parsed.version).toBe("1");
      expect(parsed.name).toBe(UPDATED_NAME);
      expect(parsed.actions.length).toBeGreaterThan(0);
      expect(parsed.actions[0]?.type).toBe("VisitAndExtract");
    }, 30_000);

    it("campaign-delete tool archives the campaign", async () => {
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

    it("campaign-list tool excludes archived campaign by default", async () => {
      const { server, getHandler } = createMockServer();
      registerCampaignList(server);

      const handler = getHandler("campaign-list");
      const result = (await handler({
        includeArchived: false,
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
        campaigns: { id: number; name: string }[];
      };

      // Archived campaign should not appear in default listing
      const found = parsed.campaigns.find((c) => c.name === UPDATED_NAME);
      expect(found).toBeUndefined();
    }, 30_000);
  });
});
