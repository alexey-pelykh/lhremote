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
import type { SearchPostsOutput } from "@lhremote/core";

// CLI handlers
import { handleSearchPosts } from "@lhremote/cli/handlers";

// MCP tool registrations
import { registerSearchPosts } from "@lhremote/mcp/tools";
import { createMockServer } from "@lhremote/mcp/testing";

describeE2E("search-posts operation", () => {
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

    it("search-posts --json returns matching posts", async () => {
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleSearchPosts("linkedin", { cdpPort, count: 5, json: true });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      const parsed = JSON.parse(output) as SearchPostsOutput;

      expect(parsed.query).toBe("linkedin");
      expect(Array.isArray(parsed.posts)).toBe(true);
      expect(parsed.posts.length).toBeGreaterThan(0);

      // Verify at least one post has a URL (extraction may fail for some)
      const postsWithUrls = parsed.posts.filter((p) => p.url !== null);
      expect(postsWithUrls.length).toBeGreaterThan(0);

      const post = parsed.posts[0] as (typeof parsed.posts)[number];
      expect(typeof post.reactionCount).toBe("number");
      expect(typeof post.commentCount).toBe("number");

      // Content extraction: at least 50% of posts should have non-null fields
      const minRequired = Math.ceil(parsed.posts.length / 2);
      const postsWithText = parsed.posts.filter((p) => p.text !== null);
      expect(postsWithText.length).toBeGreaterThanOrEqual(minRequired);
      const postsWithAuthorName = parsed.posts.filter((p) => p.authorName !== null);
      expect(postsWithAuthorName.length).toBeGreaterThanOrEqual(minRequired);
      const postsWithTimestamp = parsed.posts.filter((p) => p.timestamp !== null);
      expect(postsWithTimestamp.length).toBeGreaterThanOrEqual(minRequired);
    }, 60_000);

    it("search-posts prints human-friendly output", async () => {
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleSearchPosts("linkedin", { cdpPort, count: 3 });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      expect(output).toContain("Search:");
    }, 60_000);
  });

  describe("MCP tools", () => {
    it("search-posts tool returns valid JSON", async () => {
      const { server, getHandler } = createMockServer();
      registerSearchPosts(server);

      const handler = getHandler("search-posts");
      const result = (await handler({ query: "linkedin", count: 5, cdpPort })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(result.isError, `MCP tool error: ${result.content?.[0]?.text}`).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(
        (result.content[0] as { text: string }).text,
      ) as SearchPostsOutput;

      expect(parsed.query).toBe("linkedin");
      expect(Array.isArray(parsed.posts)).toBe(true);
      expect(parsed.posts.length).toBeGreaterThan(0);

      // Verify at least one post has a URL
      const postsWithUrls = parsed.posts.filter((p) => p.url !== null);
      expect(postsWithUrls.length).toBeGreaterThan(0);

      // Content extraction: at least 50% of posts should have non-null fields
      const minRequired = Math.ceil(parsed.posts.length / 2);
      const postsWithText = parsed.posts.filter((p) => p.text !== null);
      expect(postsWithText.length).toBeGreaterThanOrEqual(minRequired);
      const postsWithAuthorName = parsed.posts.filter((p) => p.authorName !== null);
      expect(postsWithAuthorName.length).toBeGreaterThanOrEqual(minRequired);
      const postsWithTimestamp = parsed.posts.filter((p) => p.timestamp !== null);
      expect(postsWithTimestamp.length).toBeGreaterThanOrEqual(minRequired);
    }, 60_000);

    it("search-posts tool paginates with cursor", async () => {
      const { server, getHandler } = createMockServer();
      registerSearchPosts(server);
      const handler = getHandler("search-posts");

      // Page 1: request 2 posts
      const page1 = (await handler({ query: "linkedin", count: 2, cdpPort })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };
      expect(page1.isError).toBeUndefined();
      const parsed1 = JSON.parse(
        (page1.content[0] as { text: string }).text,
      ) as SearchPostsOutput;

      expect(parsed1.posts.length).toBe(2);
      expect(parsed1.nextCursor).toBe(2);

      // Page 2: use cursor from page 1
      const page2 = (await handler({ query: "linkedin", count: 2, cursor: parsed1.nextCursor, cdpPort })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };
      expect(page2.isError).toBeUndefined();
      const parsed2 = JSON.parse(
        (page2.content[0] as { text: string }).text,
      ) as SearchPostsOutput;

      expect(parsed2.posts.length).toBeGreaterThan(0);

      // Page 2 URLs should differ from page 1
      const page1Urls = new Set(parsed1.posts.map((p) => p.url));
      for (const post of parsed2.posts) {
        expect(page1Urls.has(post.url)).toBe(false);
      }
    }, 120_000);
  });
});
