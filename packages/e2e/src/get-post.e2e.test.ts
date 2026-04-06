// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertDefined, describeE2E, forceStopInstance, launchApp, quitApp, resolveAccountId, retryAsync } from "@lhremote/core/testing";
import {
  type AppService,
  discoverInstancePort,
  discoverTargets,
  LauncherService,
  startInstanceWithRecovery,
} from "@lhremote/core";
import type { GetPostOutput } from "@lhremote/core";

// CLI handlers
import { handleGetPost } from "@lhremote/cli/handlers";

// MCP tool registrations
import { registerGetPost } from "@lhremote/mcp/tools";
import { createMockServer } from "@lhremote/mcp/testing";

/**
 * Fetch a fresh post URL by scraping the feed.  Returns the URL of the
 * first feed post, or `undefined` when the feed returns no posts or the
 * first post has no URL.
 */
async function fetchPostUrlFromFeed(cdpPort: number): Promise<string | undefined> {
  const { getFeed } = await import("@lhremote/core");
  const result = await getFeed({ cdpPort, count: 1 });
  const first = result.posts[0];
  return first?.url ?? undefined;
}

describeE2E("get-post operation", () => {
  let app: AppService;
  let port: number;
  let accountId: number;
  let cdpPort: number;
  let capturedPostUrl: string | undefined;

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

    // Pre-fetch a live post URL from the feed (retry — feed may not render immediately)
    capturedPostUrl = await retryAsync(
      async () => {
        const url = await fetchPostUrlFromFeed(cdpPort);
        if (url === undefined) throw new Error("Feed returned no posts yet");
        return url;
      },
      { retries: 5, delay: 3_000 },
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

    it("get-post --json returns post content", async () => {
      assertDefined(capturedPostUrl, "No post URL — feed returned no posts");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleGetPost(capturedPostUrl, { cdpPort, json: true });

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
      assertDefined(capturedPostUrl, "No post URL — feed returned no posts");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleGetPost(capturedPostUrl, { cdpPort });

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
      assertDefined(capturedPostUrl, "No post URL — feed returned no posts");

      const { server, getHandler } = createMockServer();
      registerGetPost(server);

      const handler = getHandler("get-post");
      const result = (await handler({ postUrl: capturedPostUrl, cdpPort })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(result.isError, `MCP tool error: ${result.content?.[0]?.text}`).toBeUndefined();
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
