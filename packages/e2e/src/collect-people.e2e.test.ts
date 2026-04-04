// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertDefined, describeE2E, forceStopInstance, launchApp, quitApp, resolveAccountId, retryAsync } from "@lhremote/core/testing";
import {
  type AppService,
  LauncherService,
  startInstanceWithRecovery,
} from "@lhremote/core";

// CLI handlers
import {
  handleCampaignCreate,
  handleCampaignDelete,
  handleCampaignErase,
  handleCampaignListPeople,
  handleCampaignStatus,
  handleCollectPeople,
} from "@lhremote/cli/handlers";

// MCP tool registration
import {
  registerCampaignCreate,
  registerCampaignDelete,
  registerCampaignErase,
  registerCampaignListPeople,
  registerCollectPeople,
} from "@lhremote/mcp/tools";
import { createMockServer } from "@lhremote/mcp/testing";

/** Minimal campaign config for collect-people tests — needs at least one action. */
const TEST_CAMPAIGN_YAML = `
version: "1"
name: E2E Collect People Campaign
description: Created by E2E collect-people tests
actions:
  - type: VisitAndExtract
`.trimStart();

/**
 * LinkedIn people search URL used for collection.
 * Uses a narrow search to minimize collection time — broad searches
 * like "software engineer" scrape hundreds of pages.
 */
const TEST_SOURCE_URL =
  "https://www.linkedin.com/search/results/people/?keywords=ollybriz&origin=GLOBAL_SEARCH_HEADER";

/** Maximum time to wait for collection to complete (ms). */
const COLLECTION_TIMEOUT = 600_000;

/** Interval between collection completion polls (ms). */
const COLLECTION_POLL_INTERVAL = 3_000;

/** Maximum retries for collect-people (page recognition can fail transiently). */
const COLLECT_RETRIES = 3;

/** Delay between collect-people retries (ms). */
const COLLECT_RETRY_DELAY = 5_000;

/** Maximum time to wait for the instance to reach idle after startup (ms). */
const IDLE_TIMEOUT = 60_000;

/** Interval between idle-state polls (ms). */
const IDLE_POLL_INTERVAL = 2_000;

/**
 * Poll campaign-status via CLI until the runner reaches idle state.
 * Used both after instance startup (waiting for initialization to complete)
 * and after collect-people (waiting for collection to finish).
 */
async function waitForRunnerIdle(
  campaignId: number,
  port: number,
  timeout: number = COLLECTION_TIMEOUT,
  interval: number = COLLECTION_POLL_INTERVAL,
): Promise<void> {
  await retryAsync(
    async () => {
      const previousExitCode = process.exitCode;
      process.exitCode = undefined;
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);
      try {
        await handleCampaignStatus(campaignId, { cdpPort: port, json: true });

        if (typeof process.exitCode === "number" && process.exitCode !== 0) {
          throw new Error(
            `campaign-status failed with exit code ${String(process.exitCode)}`,
          );
        }

        const output = stdoutSpy.mock.calls
          .map((call) => String(call[0]))
          .join("");
        const parsed = JSON.parse(output) as {
          runnerState: string;
        };

        if (parsed.runnerState !== "idle") {
          throw new Error(
            `Runner still active (state: ${parsed.runnerState})`,
          );
        }
      } finally {
        stdoutSpy.mockRestore();
        process.exitCode = previousExitCode;
      }
    },
    {
      retries: Math.ceil(timeout / interval),
      delay: interval,
    },
  );
}

describeE2E("collect-people operation", () => {
  let app: AppService;
  let port: number;
  let accountId: number;

  beforeAll(async () => {
    const launched = await launchApp();
    app = launched.app;
    port = launched.port;

    accountId = await resolveAccountId(port);

    // Start an account instance — required by collection operations
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

      expect(parsed.name).toBe("E2E Collect People Campaign");
      expect(parsed.state).toBe("paused");
    }, 30_000);

    it("collect-people --json starts collection from LinkedIn search URL", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      // Wait for instance to finish initializing before attempting collection
      await waitForRunnerIdle(campaignId, port, IDLE_TIMEOUT, IDLE_POLL_INTERVAL);

      // Retry collect-people — page recognition can fail transiently if the
      // LinkedIn browser session isn't fully warmed up after instance startup.
      let lastOutput = "";
      await retryAsync(
        async () => {
          const previousExitCode = process.exitCode;
          process.exitCode = undefined;
          const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockReturnValue(true);
          try {
            await handleCollectPeople(campaignId, TEST_SOURCE_URL, {
              cdpPort: port,
              json: true,
            });
            if (typeof process.exitCode === "number" && process.exitCode !== 0) {
              throw new Error("collect-people exited with non-zero exit code");
            }
            lastOutput = stdoutSpy.mock.calls
              .map((call) => String(call[0]))
              .join("");
          } finally {
            stdoutSpy.mockRestore();
            process.exitCode = previousExitCode;
          }
        },
        { retries: COLLECT_RETRIES, delay: COLLECT_RETRY_DELAY },
      );

      const parsed = JSON.parse(lastOutput) as {
        success: boolean;
        campaignId: number;
        sourceType: string;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.sourceType).toBe("SearchPage");
    }, 60_000 + COLLECT_RETRIES * (COLLECT_RETRY_DELAY + 30_000));

    it("campaign-list-people shows collected people after completion", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      // Wait for collection to finish (runner returns to idle)
      await waitForRunnerIdle(campaignId, port);

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
      expect(parsed.total).toBeGreaterThanOrEqual(1);
      expect(parsed.people.length).toBeGreaterThanOrEqual(1);
    }, COLLECTION_TIMEOUT + 30_000);

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

      expect(parsed.name).toBe("E2E Collect People Campaign");
      expect(parsed.state).toBe("paused");
    }, 30_000);

    it("collect-people tool starts collection from LinkedIn search URL", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      // Wait for instance to finish initializing before attempting collection
      await waitForRunnerIdle(campaignId, port, IDLE_TIMEOUT, IDLE_POLL_INTERVAL);

      // Retry collect-people — page recognition can fail transiently
      let lastResult: { isError?: boolean; content: { type: string; text: string }[] } | undefined;
      await retryAsync(
        async () => {
          const { server, getHandler } = createMockServer();
          registerCollectPeople(server);

          const handler = getHandler("collect-people");
          const result = (await handler({
            campaignId,
            sourceUrl: TEST_SOURCE_URL,
            cdpPort: port,
          })) as {
            isError?: boolean;
            content: { type: string; text: string }[];
          };

          if (result.isError) {
            throw new Error(
              `collect-people returned error: ${(result.content[0] as { text: string }).text}`,
            );
          }
          lastResult = result;
        },
        { retries: COLLECT_RETRIES, delay: COLLECT_RETRY_DELAY },
      );

      assertDefined(lastResult, "collect-people must succeed");
      expect(lastResult.content).toHaveLength(1);

      const parsed = JSON.parse(
        (lastResult.content[0] as { text: string }).text,
      ) as {
        success: boolean;
        campaignId: number;
        sourceType: string;
      };

      expect(parsed.success).toBe(true);
      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.sourceType).toBe("SearchPage");
    }, 60_000 + COLLECT_RETRIES * (COLLECT_RETRY_DELAY + 30_000));

    it("campaign-list-people tool shows collected people after completion", async () => {
      assertDefined(campaignId, "campaign-create must run first");

      // Wait for collection to finish (runner returns to idle)
      await waitForRunnerIdle(campaignId, port);

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

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(
        (result.content[0] as { text: string }).text,
      ) as {
        campaignId: number;
        people: { personId: number }[];
        total: number;
      };

      expect(parsed.campaignId).toBe(campaignId);
      expect(parsed.total).toBeGreaterThanOrEqual(1);
      expect(parsed.people.length).toBeGreaterThanOrEqual(1);
    }, COLLECTION_TIMEOUT + 30_000);

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
    }, 30_000);
  });
});
