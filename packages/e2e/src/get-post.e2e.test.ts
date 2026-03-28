// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { describeE2E, launchApp, quitApp, retryAsync } from "@lhremote/core/testing";
import {
  type Account,
  type AppService,
  discoverInstancePort,
  discoverTargets,
  killInstanceProcesses,
  LauncherService,
  startInstanceWithRecovery,
  waitForInstanceShutdown,
} from "@lhremote/core";
import type { GetPostOutput } from "@lhremote/core";

// CLI handlers
import { handleGetPost } from "@lhremote/cli/handlers";

// MCP tool registrations
import { registerGetPost } from "@lhremote/mcp/tools";
import { createMockServer } from "@lhremote/mcp/testing";

/**
 * Fetch a fresh post URN by scraping the feed.  Returns the URN of the
 * first feed post, or `undefined` when the feed returns no posts.
 */
async function fetchPostUrnFromFeed(cdpPort: number): Promise<string | undefined> {
  const { getFeed } = await import("@lhremote/core");
  const result = await getFeed({ cdpPort, count: 1 });
  const first = result.posts[0];
  return first?.urn ?? undefined;
}

/** Type-narrowing assertion — fails the test with `message` when `value` is nullish. */
function assertDefined<T>(value: T, message: string): asserts value is NonNullable<T> {
  expect(value, message).toBeDefined();
  expect(value, message).not.toBeNull();
}

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

describeE2E("get-post operation", () => {
  let app: AppService;
  let port: number;
  let accountId: number | undefined;
  let cdpPort: number;
  let capturedPostUrn: string | undefined;

  beforeAll(async () => {
    const launched = await launchApp();
    app = launched.app;
    port = launched.port;

    const launcher = new LauncherService(port);
    await retryAsync(() => launcher.connect(), { retries: 3, delay: 1_000 });
    const accounts = await launcher.listAccounts();

    if (accounts.length > 0) {
      accountId = (accounts[0] as Account).id;
      await startInstanceWithRecovery(launcher, accountId, port);
    }

    launcher.disconnect();

    if (accountId === undefined) return;

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

    // Pre-fetch a live post URN from the feed
    capturedPostUrn = await fetchPostUrnFromFeed(cdpPort);
  }, 120_000);

  afterAll(async () => {
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

  describe("CLI handlers", () => {
    const originalExitCode = process.exitCode;

    beforeEach(() => {
      process.exitCode = undefined;
    });

    afterEach(() => {
      process.exitCode = originalExitCode;
      vi.restoreAllMocks();
    });

    it("get-post --json returns post content", async () => {
      assertDefined(capturedPostUrn, "No post URN — feed returned no posts");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleGetPost(capturedPostUrn, { cdpPort, json: true });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      const parsed = JSON.parse(output) as GetPostOutput;

      expect(parsed.post).toHaveProperty("postUrn");
      expect(typeof parsed.post.postUrn).toBe("string");
      expect(typeof parsed.post.authorName).toBe("string");
      expect(typeof parsed.post.reactionCount).toBe("number");
      expect(typeof parsed.post.commentCount).toBe("number");
      expect(typeof parsed.post.shareCount).toBe("number");
      expect(Array.isArray(parsed.comments)).toBe(true);
      expect(parsed.commentsPaging).toHaveProperty("total");
    }, 60_000);

    it("get-post prints human-friendly output", async () => {
      assertDefined(capturedPostUrn, "No post URN — feed returned no posts");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleGetPost(capturedPostUrn, { cdpPort });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      expect(output).toContain("Post:");
      expect(output).toContain("Reactions:");
    }, 60_000);
  });

  describe("MCP tools", () => {
    it("get-post tool returns valid JSON", async () => {
      assertDefined(capturedPostUrn, "No post URN — feed returned no posts");

      const { server, getHandler } = createMockServer();
      registerGetPost(server);

      const handler = getHandler("get-post");
      const result = (await handler({ postUrl: capturedPostUrn, cdpPort })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(
        (result.content[0] as { text: string }).text,
      ) as GetPostOutput;

      expect(parsed.post).toHaveProperty("postUrn");
      expect(typeof parsed.post.authorName).toBe("string");
      expect(Array.isArray(parsed.comments)).toBe(true);
      expect(parsed.commentsPaging).toHaveProperty("total");
    }, 60_000);
  });
});
