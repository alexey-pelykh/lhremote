// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeE2E,
  forceStopInstance,
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
import type { CheckRepliesOutput } from "@lhremote/core";

// CLI handler
import { handleCheckReplies } from "@lhremote/cli/handlers";

// MCP tool registration
import { registerCheckReplies } from "@lhremote/mcp/tools";
import { createMockServer } from "@lhremote/mcp/testing";

describeE2E("check-replies", () => {
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

    it("--json checks for replies and returns JSON", async () => {
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleCheckReplies({
        cdpPort: port,
        json: true,
      });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      const parsed = JSON.parse(output) as CheckRepliesOutput;

      expect(Array.isArray(parsed.newMessages)).toBe(true);
      expect(typeof parsed.totalNew).toBe("number");
      expect(parsed.checkedAt).toBeTruthy();
    }, 180_000);

    it("prints human-friendly output", async () => {
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleCheckReplies({
        cdpPort: port,
      });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      expect(output).toMatch(/new message|No new messages/);
    }, 180_000);
  });

  describe("MCP tool", () => {
    it("checks for replies and returns results", async () => {
      const { server, getHandler } = createMockServer();
      registerCheckReplies(server);

      const handler = getHandler("check-replies");
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
      ) as CheckRepliesOutput;

      expect(Array.isArray(parsed.newMessages)).toBe(true);
      expect(typeof parsed.totalNew).toBe("number");
      expect(parsed.checkedAt).toBeTruthy();
    }, 180_000);
  });
});
