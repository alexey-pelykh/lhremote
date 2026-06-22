// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeE2E,
  forceStopInstance,
  installErrorDetection,
  launchApp,
  quitApp,
  resolveAccountId,
  retryAsync,
} from "@insoftex/lhremote-core/testing";
import {
  type AppService,
  discoverInstancePort,
  discoverTargets,
  dismissErrors,
  LauncherService,
  startInstanceWithRecovery,
} from "@insoftex/lhremote-core";
import type { DismissFeedPostOutput } from "@insoftex/lhremote-core";

// CLI handlers
import { handleDismissFeedPost } from "@insoftex/lhremote-cli/handlers";

// MCP tool registrations
import { registerDismissFeedPost } from "@insoftex/lhremote-mcp/tools";
import { createMockServer } from "@insoftex/lhremote-mcp/testing";

describeE2E("feed dismissal operations", () => {
  let app: AppService;
  let port: number;
  let accountId: number;
  let cdpPort: number;

  beforeAll(async () => {
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
      { retries: 30, delay: 2_000 },
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

  // ── dismiss-feed-post ───────────────────────────────────────────────
  //
  // The first few feed posts can be sponsored or own posts (no "Not interested"
  // option in the three-dot menu — see operations/dismiss-feed-post.ts §
  // clickNotInterested).  Tests therefore walk index 0..N until they find a
  // post whose three-dot menu contains "Not interested" rather than asserting
  // on a specific index.  See issue #784 for the original flake.

  /**
   * Maximum feed indices to try when looking for a dismissable post.
   * 5 covers the typical "1-2 sponsored at top + 1 own post pinned" worst
   * case while keeping the upper bound on flake time bounded (≈ 5 × ~20s).
   */
  const MAX_FEED_INDEX_PROBE = 5;

  describe("dismiss-feed-post", () => {
    describe("CLI handlers", () => {
      const originalExitCode = process.exitCode;

      beforeEach(() => {
        process.exitCode = undefined;
      });

      afterEach(() => {
        process.exitCode = originalExitCode;
        vi.restoreAllMocks();
      });

      it("dismiss-feed-post --json --dry-run reports dry-run result", async () => {
        let parsed: DismissFeedPostOutput | undefined;
        let lastError: string | undefined;
        for (let idx = 0; idx < MAX_FEED_INDEX_PROBE; idx++) {
          process.exitCode = undefined;
          const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
          const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

          await handleDismissFeedPost(idx, { cdpPort, json: true, dryRun: true });

          const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
          const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
          stdoutSpy.mockRestore();
          stderrSpy.mockRestore();

          if (process.exitCode !== undefined) {
            lastError = stderr || `exitCode=${String(process.exitCode)}`;
            // Sponsored / own / hidden post — try next index
            continue;
          }

          parsed = JSON.parse(stdout) as DismissFeedPostOutput;
          expect(parsed.feedIndex).toBe(idx);
          break;
        }

        if (!parsed) {
          throw new Error(
            `No dismissable post found in feed indices 0..${String(MAX_FEED_INDEX_PROBE - 1)} ` +
              `(last error: ${lastError ?? "none"})`,
          );
        }
        expect(parsed.success).toBe(true);
        expect(parsed.dryRun).toBe(true);
      }, 600_000);

      it("dismiss-feed-post --dry-run (human-friendly) includes [dry-run] prefix", async () => {
        let success = false;
        let lastError: string | undefined;
        for (let idx = 0; idx < MAX_FEED_INDEX_PROBE; idx++) {
          process.exitCode = undefined;
          const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
          const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

          await handleDismissFeedPost(idx, { cdpPort, dryRun: true });

          const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
          const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
          stdoutSpy.mockRestore();
          stderrSpy.mockRestore();

          if (process.exitCode !== undefined) {
            lastError = stderr || `exitCode=${String(process.exitCode)}`;
            continue;
          }
          if (stdout.includes("[dry-run]")) {
            success = true;
            break;
          }
        }
        expect(
          success,
          `No dismissable post found in feed indices 0..${String(MAX_FEED_INDEX_PROBE - 1)} ` +
            `(last error: ${lastError ?? "none"})`,
        ).toBe(true);
      }, 600_000);
    });

    describe("MCP tools", () => {
      it("dismiss-feed-post tool returns valid dry-run JSON", async () => {
        const { server, getHandler } = createMockServer();
        registerDismissFeedPost(server);
        const handler = getHandler("dismiss-feed-post");

        let parsed: DismissFeedPostOutput | undefined;
        let lastError: string | undefined;
        for (let idx = 0; idx < MAX_FEED_INDEX_PROBE; idx++) {
          const result = (await handler({
            feedIndex: idx,
            cdpPort,
            dryRun: true,
          })) as {
            isError?: boolean;
            content: { type: string; text: string }[];
          };

          if (result.isError) {
            lastError = result.content?.[0]?.text;
            continue;
          }

          expect(result.content).toHaveLength(1);
          parsed = JSON.parse(
            (result.content[0] as { text: string }).text,
          ) as DismissFeedPostOutput;
          expect(parsed.feedIndex).toBe(idx);
          break;
        }

        if (!parsed) {
          throw new Error(
            `No dismissable post found in feed indices 0..${String(MAX_FEED_INDEX_PROBE - 1)} ` +
              `(last error: ${lastError ?? "none"})`,
          );
        }
        expect(parsed.success).toBe(true);
        expect(parsed.dryRun).toBe(true);
      }, 600_000);
    });
  });
});
