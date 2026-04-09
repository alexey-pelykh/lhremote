// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeE2E,
  forceStopInstance,
  getE2EPostUrl,
  installErrorDetection,
  launchApp,
  quitApp,
  resolveAccountId,
  retryAsync,
} from "@lhremote/core/testing";
import {
  type AppService,
  discoverInstancePort,
  discoverTargets,
  dismissErrors,
  LauncherService,
  startInstanceWithRecovery,
} from "@lhremote/core";
import type { UnfollowFromFeedOutput } from "@lhremote/core";

// CLI handlers
import { handleUnfollowFromFeed } from "@lhremote/cli/handlers";

// MCP tool registrations
import { registerUnfollowFromFeed } from "@lhremote/mcp/tools";
import { createMockServer } from "@lhremote/mcp/testing";

describeE2E("unfollow-from-feed operation", () => {
  let app: AppService;
  let port: number;
  let accountId: number;
  let cdpPort: number;
  let postUrl: string;

  beforeAll(async () => {
    postUrl = getE2EPostUrl();

    const launched = await launchApp();
    app = launched.app;
    port = launched.port;

    accountId = await resolveAccountId(port);

    const launcher = new LauncherService(port);
    try {
      await retryAsync(() => launcher.connect(), { retries: 3, delay: 1_000 });
      await startInstanceWithRecovery(launcher, accountId, port);
    } finally {
      launcher.disconnect();
    }

    // Discover the instance's dynamic CDP port
    const instancePort = await retryAsync(
      async () => {
        const p = await discoverInstancePort(port);
        if (p === null) throw new Error("Instance CDP port not discovered yet");
        return p;
      },
      { retries: 10, delay: 2_000 },
    );
    cdpPort = instancePort;

    // Wait for the LinkedIn WebView to become available
    await retryAsync(
      async () => {
        const targets = await discoverTargets(cdpPort);
        const hasLinkedIn = targets.some(
          (t) => t.type === "page" && t.url?.includes("linkedin.com"),
        );
        if (!hasLinkedIn) {
          throw new Error("LinkedIn target not available yet");
        }
      },
      { retries: 30, delay: 2_000 },
    );
  }, 120_000);

  // Dismiss any leftover error popups before each test to prevent cascade failures
  beforeEach(async () => {
    await dismissErrors({ cdpPort, accountId }).catch(() => {});
  }, 30_000);

  installErrorDetection(() => port);

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

  // ── CLI handlers ──────────────────────────────────────────────────

  describe("CLI handlers", () => {
    const originalExitCode = process.exitCode;

    beforeEach(() => {
      process.exitCode = undefined;
    });

    afterEach(() => {
      process.exitCode = originalExitCode;
      vi.restoreAllMocks();
    });

    it("unfollow-from-feed --json returns valid result", async () => {
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
      const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

      await handleUnfollowFromFeed(postUrl, { cdpPort, json: true });

      const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(process.exitCode, `CLI handler error: ${stderr}`).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
      const parsed = JSON.parse(output) as UnfollowFromFeedOutput;

      expect(parsed.success).toBe(true);
      expect(parsed.postUrl).toBe(postUrl);
      expect(typeof parsed.unfollowedName).toBe("string");
      expect(parsed.unfollowedName.length).toBeGreaterThan(0);
    }, 120_000);
  });

  // ── MCP tools ─────────────────────────────────────────────────────

  describe("MCP tools", () => {
    it("unfollow-from-feed tool returns valid JSON", async () => {
      const { server, getHandler } = createMockServer();
      registerUnfollowFromFeed(server);

      const handler = getHandler("unfollow-from-feed");
      const result = (await handler({
        postUrl,
        cdpPort,
      })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(result.isError, `MCP tool error: ${result.content?.[0]?.text}`).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(
        (result.content[0] as { text: string }).text,
      ) as UnfollowFromFeedOutput;

      expect(parsed.success).toBe(true);
      expect(parsed.postUrl).toBe(postUrl);
      expect(typeof parsed.unfollowedName).toBe("string");
      expect(parsed.unfollowedName.length).toBeGreaterThan(0);
    }, 120_000);
  });
});
