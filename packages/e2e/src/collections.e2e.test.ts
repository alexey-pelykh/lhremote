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
  handleAddPeopleToCollection,
  handleCampaignCreate,
  handleCampaignErase,
  handleCreateCollection,
  handleDeleteCollection,
  handleImportPeopleFromCollection,
  handleListCollections,
  handleRemovePeopleFromCollection,
} from "@lhremote/cli/handlers";

// MCP tool registration
import {
  registerAddPeopleToCollection,
  registerCampaignCreate,
  registerCampaignErase,
  registerCreateCollection,
  registerDeleteCollection,
  registerImportPeopleFromCollection,
  registerListCollections,
  registerRemovePeopleFromCollection,
} from "@lhremote/mcp/tools";
import { createMockServer } from "@lhremote/mcp/testing";

const TEST_COLLECTION_NAME = `E2E Test Collection ${Date.now()}`;

/** Minimal campaign config for import-people-from-collection test. */
const TEST_CAMPAIGN_YAML = `
version: "1"
name: E2E Collection Import
description: Created by E2E collection tests
actions:
  - type: VisitAndExtract
`.trimStart();

describeE2E("Collections (create, list, delete, add/remove people, import)", () => {
  let app: AppService;
  let port: number;
  let accountId: number;

  /** Person ID from the environment — used for add/remove/import tests. */
  const personId = getE2EPersonId();

  beforeAll(async () => {
    const launched = await launchApp();
    app = launched.app;
    port = launched.port;

    accountId = await resolveAccountId(port);

    const launcher = new LauncherService(port);
    await retryAsync(() => launcher.connect(), { retries: 3, delay: 1_000 });
    await startInstanceWithRecovery(launcher, accountId, port);
    launcher.disconnect();
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

  // -----------------------------------------------------------------------
  // CLI handlers
  // -----------------------------------------------------------------------

  describe("CLI handlers", () => {
    const originalExitCode = process.exitCode;

    /** Collection ID created during the test — used across sequential steps. */
    let collectionId: number | undefined;

    /** Campaign ID created for the import test — erased in afterAll. */
    let campaignId: number | undefined;

    afterAll(async () => {
      const previousExitCode = process.exitCode;
      try {
        process.exitCode = undefined;
        vi.spyOn(process.stdout, "write").mockReturnValue(true);
        if (collectionId !== undefined) {
          await handleDeleteCollection(collectionId, { cdpPort: port });
        }
        if (campaignId !== undefined) {
          await handleCampaignErase(campaignId, { cdpPort: port });
        }
      } catch {
        // Best-effort cleanup
      } finally {
        process.exitCode = previousExitCode;
        vi.restoreAllMocks();
      }
    });

    beforeEach(() => {
      process.exitCode = undefined;
    });

    afterEach(() => {
      process.exitCode = originalExitCode;
      vi.restoreAllMocks();
    });

    it("create-collection creates a collection", async () => {
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleCreateCollection(TEST_COLLECTION_NAME, {
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
        collectionId: number;
        name: string;
      };

      expect(parsed.collectionId).toBeGreaterThan(0);
      collectionId = parsed.collectionId;

      expect(parsed.success).toBe(true);
      expect(parsed.name).toBe(TEST_COLLECTION_NAME);
    }, 30_000);

    it("list-collections includes the created collection", async () => {
      assertDefined(collectionId, "create-collection must run first");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleListCollections({ json: true });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      const parsed = JSON.parse(output) as {
        collections: { id: number; name: string; peopleCount: number }[];
        total: number;
      };

      const found = parsed.collections.find((c) => c.name === TEST_COLLECTION_NAME);
      assertDefined(found, "E2E Test Collection not found in CLI list");
      expect(found.id).toBe(collectionId);
    }, 30_000);

    it("add-people-to-collection adds a person", async () => {
      assertDefined(collectionId, "create-collection must run first");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleAddPeopleToCollection(collectionId, {
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
        collectionId: number;
        added: number;
        alreadyInCollection: number;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.collectionId).toBe(collectionId);
      expect(parsed.added).toBe(1);
      expect(parsed.alreadyInCollection).toBe(0);
    }, 30_000);

    it("import-people-from-collection imports into a campaign", async () => {
      assertDefined(collectionId, "create-collection must run first");

      // Create a campaign for import
      const createSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleCampaignCreate({
        yaml: TEST_CAMPAIGN_YAML,
        cdpPort: port,
        json: true,
      });

      expect(process.exitCode).toBeUndefined();

      const createOutput = createSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      const campaign = JSON.parse(createOutput) as { id: number };
      expect(campaign.id).toBeGreaterThan(0);
      campaignId = campaign.id;

      vi.restoreAllMocks();
      process.exitCode = undefined;

      // Import people from collection into campaign
      const importSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleImportPeopleFromCollection(collectionId, campaignId, {
        cdpPort: port,
        json: true,
      });

      expect(process.exitCode).toBeUndefined();
      expect(importSpy).toHaveBeenCalled();

      const importOutput = importSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      const parsed = JSON.parse(importOutput) as {
        success: boolean;
        collectionId: number;
        campaignId: number;
        actionId: number;
        totalUrls: number;
        imported: number;
        alreadyInQueue: number;
        alreadyProcessed: number;
        failed: number;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.collectionId).toBe(collectionId);
      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.actionId).toBeGreaterThan(0);
      expect(parsed.totalUrls).toBeGreaterThanOrEqual(1);
      expect(parsed.imported).toBeGreaterThanOrEqual(1);
    }, 30_000);

    it("remove-people-from-collection removes a person", async () => {
      assertDefined(collectionId, "create-collection must run first");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleRemovePeopleFromCollection(collectionId, {
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
        collectionId: number;
        removed: number;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.collectionId).toBe(collectionId);
      expect(parsed.removed).toBe(1);
    }, 30_000);

    it("delete-collection deletes the collection", async () => {
      assertDefined(collectionId, "create-collection must run first");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleDeleteCollection(collectionId, {
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
        collectionId: number;
        deleted: boolean;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.collectionId).toBe(collectionId);
      expect(parsed.deleted).toBe(true);

      // Mark as cleaned up so afterAll doesn't re-delete
      collectionId = undefined;
    }, 30_000);

    it("list-collections excludes the deleted collection", async () => {
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleListCollections({ json: true });

      expect(process.exitCode).toBeUndefined();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      const parsed = JSON.parse(output) as {
        collections: { id: number; name: string }[];
      };

      const found = parsed.collections.find(
        (c) => c.name === TEST_COLLECTION_NAME,
      );
      expect(found).toBeUndefined();
    }, 30_000);
  });

  // -----------------------------------------------------------------------
  // MCP tools
  // -----------------------------------------------------------------------

  describe("MCP tools", () => {
    /** Collection ID created during the test — used across sequential steps. */
    let collectionId: number | undefined;

    /** Campaign ID created for the import test — erased in afterAll. */
    let campaignId: number | undefined;

    afterAll(async () => {
      if (collectionId !== undefined) {
        const { server, getHandler } = createMockServer();
        registerDeleteCollection(server);
        try {
          await getHandler("delete-collection")({
            collectionId,
            cdpPort: port,
          });
        } catch {
          // Best-effort cleanup
        }
      }
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

    it("create-collection tool creates a collection", async () => {
      const { server, getHandler } = createMockServer();
      registerCreateCollection(server);

      const handler = getHandler("create-collection");
      const result = (await handler({
        name: TEST_COLLECTION_NAME,
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
        collectionId: number;
        name: string;
      };

      expect(parsed.collectionId).toBeGreaterThan(0);
      collectionId = parsed.collectionId;

      expect(parsed.success).toBe(true);
      expect(parsed.name).toBe(TEST_COLLECTION_NAME);
    }, 30_000);

    it("list-collections tool includes the created collection", async () => {
      assertDefined(collectionId, "create-collection must run first");

      const { server, getHandler } = createMockServer();
      registerListCollections(server);

      const handler = getHandler("list-collections");
      const result = (await handler({
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
        collections: { id: number; name: string; peopleCount: number }[];
        total: number;
      };

      const found = parsed.collections.find((c) => c.id === collectionId);
      assertDefined(found, `Collection #${String(collectionId)} not found in MCP list`);
      expect(found.name).toBe(TEST_COLLECTION_NAME);
      expect(found.peopleCount).toBe(0);
    }, 30_000);

    it("add-people-to-collection tool adds a person", async () => {
      assertDefined(collectionId, "create-collection must run first");

      const { server, getHandler } = createMockServer();
      registerAddPeopleToCollection(server);

      const handler = getHandler("add-people-to-collection");
      const result = (await handler({
        collectionId,
        personIds: [personId],
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
        collectionId: number;
        added: number;
        alreadyInCollection: number;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.collectionId).toBe(collectionId);
      expect(parsed.added).toBe(1);
      expect(parsed.alreadyInCollection).toBe(0);
    }, 30_000);

    it("import-people-from-collection tool imports into a campaign", async () => {
      assertDefined(collectionId, "create-collection must run first");

      // Create a campaign for import
      const { server: createServer, getHandler: getCreateHandler } =
        createMockServer();
      registerCampaignCreate(createServer);

      const createResult = (await getCreateHandler("campaign-create")({
        config: TEST_CAMPAIGN_YAML,
        format: "yaml",
        cdpPort: port,
      })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(createResult.isError).toBeUndefined();

      const campaign = JSON.parse(
        (createResult.content[0] as { text: string }).text,
      ) as { id: number };
      expect(campaign.id).toBeGreaterThan(0);
      campaignId = campaign.id;

      // Import people from collection into campaign
      const { server, getHandler } = createMockServer();
      registerImportPeopleFromCollection(server);

      const handler = getHandler("import-people-from-collection");
      const result = (await handler({
        collectionId,
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
        collectionId: number;
        campaignId: number;
        actionId: number;
        totalUrls: number;
        imported: number;
        alreadyInQueue: number;
        alreadyProcessed: number;
        failed: number;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.collectionId).toBe(collectionId);
      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.actionId).toBeGreaterThan(0);
      expect(parsed.totalUrls).toBeGreaterThanOrEqual(1);
      expect(parsed.imported).toBeGreaterThanOrEqual(1);
    }, 30_000);

    it("remove-people-from-collection tool removes a person", async () => {
      assertDefined(collectionId, "create-collection must run first");

      const { server, getHandler } = createMockServer();
      registerRemovePeopleFromCollection(server);

      const handler = getHandler("remove-people-from-collection");
      const result = (await handler({
        collectionId,
        personIds: [personId],
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
        collectionId: number;
        removed: number;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.collectionId).toBe(collectionId);
      expect(parsed.removed).toBe(1);
    }, 30_000);

    it("delete-collection tool deletes the collection", async () => {
      assertDefined(collectionId, "create-collection must run first");

      const { server, getHandler } = createMockServer();
      registerDeleteCollection(server);

      const handler = getHandler("delete-collection");
      const result = (await handler({
        collectionId,
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
        collectionId: number;
        deleted: boolean;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.collectionId).toBe(collectionId);
      expect(parsed.deleted).toBe(true);

      // Mark as cleaned up so afterAll doesn't re-delete
      collectionId = undefined;
    }, 30_000);

    it("list-collections tool excludes the deleted collection", async () => {
      const { server, getHandler } = createMockServer();
      registerListCollections(server);

      const handler = getHandler("list-collections");
      const result = (await handler({
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
        collections: { id: number; name: string }[];
      };

      const found = parsed.collections.find(
        (c) => c.name === TEST_COLLECTION_NAME,
      );
      expect(found).toBeUndefined();
    }, 30_000);
  });
});
