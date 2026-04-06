// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeE2E,
  forceStopInstance,
  getE2EPersonId,
  launchApp,
  quitApp,
  resolveAccountId,
  retryAsync,
} from "@lhremote/core/testing";
import {
  type AppService,
  LauncherService,
  startInstanceWithRecovery,
} from "@lhremote/core";
import type { ScrapeMessagingHistoryOutput } from "@lhremote/core";

// CLI handler
import { handleScrapeMessagingHistory } from "@lhremote/cli/handlers";

// MCP tool registration
import { registerScrapeMessagingHistory } from "@lhremote/mcp/tools";
import { createMockServer } from "@lhremote/mcp/testing";

describeE2E("scrape-messaging-history", () => {
  let app: AppService;
  let port: number;
  let accountId: number;

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
      /* Best-effort */
    } finally {
      launcher.disconnect();
    }
    await quitApp(app);
  }, 60_000);

  describe("CLI handler", () => {
    const originalExitCode = process.exitCode;

    beforeEach(() => {
      process.exitCode = undefined;
    });

    afterEach(() => {
      process.exitCode = originalExitCode;
      vi.restoreAllMocks();
    });

    it("--json scrapes and returns stats", async () => {
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleScrapeMessagingHistory({
        personId: [getE2EPersonId()],
        cdpPort: port,
        json: true,
      });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      const parsed = JSON.parse(output) as ScrapeMessagingHistoryOutput;

      expect(parsed.success).toBe(true);
      expect(parsed.actionType).toBe("ScrapeMessagingHistory");
      expect(parsed.stats).toBeDefined();
      expect(typeof parsed.stats.totalChats).toBe("number");
      expect(typeof parsed.stats.totalMessages).toBe("number");
    }, 300_000);

    it("prints human-friendly output", async () => {
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleScrapeMessagingHistory({
        personId: [getE2EPersonId()],
        cdpPort: port,
      });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      expect(output).toMatch(/conversations/);
      expect(output).toMatch(/messages/);
    }, 300_000);
  });

  describe("MCP tool", () => {
    it("scrapes and returns stats", async () => {
      const { server, getHandler } = createMockServer();
      registerScrapeMessagingHistory(server);

      const handler = getHandler("scrape-messaging-history");
      const result = (await handler({
        personIds: [getE2EPersonId()],
        cdpPort: port,
      })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(result.isError, `MCP tool error: ${result.content?.[0]?.text}`).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(
        (result.content[0] as { text: string }).text,
      ) as ScrapeMessagingHistoryOutput;

      expect(parsed.success).toBe(true);
      expect(parsed.actionType).toBe("ScrapeMessagingHistory");
      expect(parsed.stats).toBeDefined();
      expect(typeof parsed.stats.totalChats).toBe("number");
      expect(typeof parsed.stats.totalMessages).toBe("number");
    }, 300_000);
  });
});
