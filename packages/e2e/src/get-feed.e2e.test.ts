// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { describeE2E, forceStopInstance, launchApp, quitApp, resolveAccountId, retryAsync } from "@lhremote/core/testing";
import {
  type AppService,
  discoverInstancePort,
  discoverTargets,
  LauncherService,
  startInstanceWithRecovery,
} from "@lhremote/core";
import type { FeedPost, GetFeedOutput } from "@lhremote/core";

// CLI handlers
import { handleGetFeed } from "@lhremote/cli/handlers";

// MCP tool registrations
import { registerGetFeed } from "@lhremote/mcp/tools";
import { createMockServer } from "@lhremote/mcp/testing";

describeE2E("get-feed operation", () => {
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
    await retryAsync(() => launcher.connect(), { retries: 3, delay: 1_000 });
    await startInstanceWithRecovery(launcher, accountId, port);
    launcher.disconnect();

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

  describe("CLI handlers", () => {
    const originalExitCode = process.exitCode;

    beforeEach(() => {
      process.exitCode = undefined;
    });

    afterEach(() => {
      process.exitCode = originalExitCode;
      vi.restoreAllMocks();
    });

    it("get-feed --json returns valid JSON shape", async () => {
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleGetFeed({ cdpPort, count: 5, json: true });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      const parsed = JSON.parse(output) as GetFeedOutput;

      expect(Array.isArray(parsed.posts)).toBe(true);
      expect(parsed.posts.length).toBeGreaterThan(0);

      const post = parsed.posts[0] as FeedPost;
      expect(post).toHaveProperty("url");
      expect(typeof post.url).toBe("string");
      expect(typeof post.reactionCount).toBe("number");
      expect(typeof post.commentCount).toBe("number");
      expect(typeof post.shareCount).toBe("number");
      expect(Array.isArray(post.hashtags)).toBe(true);

      // Content extraction: at least 50% of posts should have non-null fields
      const minRequired = Math.ceil(parsed.posts.length / 2);
      const postsWithText = parsed.posts.filter((p) => p.text !== null);
      expect(postsWithText.length).toBeGreaterThanOrEqual(minRequired);
      const postsWithAuthorName = parsed.posts.filter((p) => p.authorName !== null);
      expect(postsWithAuthorName.length).toBeGreaterThanOrEqual(minRequired);
      const postsWithTimestamp = parsed.posts.filter((p) => p.timestamp !== null);
      expect(postsWithTimestamp.length).toBeGreaterThanOrEqual(minRequired);
    }, 60_000);

    it("get-feed prints human-friendly output", async () => {
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleGetFeed({ cdpPort, count: 3 });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      expect(output).toContain("Reactions:");
    }, 60_000);
  });

  describe("MCP tools", () => {
    it("get-feed tool returns valid JSON", async () => {
      const { server, getHandler } = createMockServer();
      registerGetFeed(server);

      const handler = getHandler("get-feed");
      const result = (await handler({ count: 5, cdpPort })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(result.isError, `MCP tool error: ${result.content?.[0]?.text}`).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(
        (result.content[0] as { text: string }).text,
      ) as GetFeedOutput;

      expect(Array.isArray(parsed.posts)).toBe(true);
      expect(parsed.posts.length).toBeGreaterThan(0);

      const post = parsed.posts[0] as FeedPost;
      expect(post).toHaveProperty("url");
      expect(typeof post.reactionCount).toBe("number");

      // Content extraction: at least 50% of posts should have non-null fields
      const minRequired = Math.ceil(parsed.posts.length / 2);
      const postsWithText = parsed.posts.filter((p) => p.text !== null);
      expect(postsWithText.length).toBeGreaterThanOrEqual(minRequired);
      const postsWithAuthorName = parsed.posts.filter((p) => p.authorName !== null);
      expect(postsWithAuthorName.length).toBeGreaterThanOrEqual(minRequired);
      const postsWithTimestamp = parsed.posts.filter((p) => p.timestamp !== null);
      expect(postsWithTimestamp.length).toBeGreaterThanOrEqual(minRequired);
    }, 60_000);

    it("get-feed tool paginates with cursor", async () => {
      const { server, getHandler } = createMockServer();
      registerGetFeed(server);
      const handler = getHandler("get-feed");

      // Page 1: request 2 posts
      const page1 = (await handler({ count: 2, cdpPort })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };
      expect(page1.isError, `MCP tool error: ${page1.content?.[0]?.text}`).toBeUndefined();
      expect(page1.content).toHaveLength(1);
      const parsed1 = JSON.parse(
        (page1.content[0] as { text: string }).text,
      ) as GetFeedOutput;

      expect(parsed1.posts.length).toBe(2);
      expect(parsed1.nextCursor).toEqual(expect.any(String));

      // Page 2: use cursor from page 1
      const page2 = (await handler({ count: 2, cursor: parsed1.nextCursor, cdpPort })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };
      expect(page2.isError, `MCP tool error: ${page2.content?.[0]?.text}`).toBeUndefined();
      expect(page2.content).toHaveLength(1);
      const parsed2 = JSON.parse(
        (page2.content[0] as { text: string }).text,
      ) as GetFeedOutput;

      expect(parsed2.posts.length).toBeGreaterThan(0);

      // Page 2 URLs should differ from page 1 (filter nulls from failed URL extraction)
      const page1Urls = new Set(parsed1.posts.map((p) => p.url).filter((u) => u !== null));
      const page2Urls = parsed2.posts.map((p) => p.url).filter((u) => u !== null);
      expect(page1Urls.size).toBeGreaterThan(0);
      expect(page2Urls.length).toBeGreaterThan(0);
      for (const url of page2Urls) {
        expect(page1Urls.has(url)).toBe(false);
      }
    }, 120_000);
  });
});
