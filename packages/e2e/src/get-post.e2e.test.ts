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
 * first member-authored feed post that ALSO has at least one comment
 * (i.e. `authorProfileUrl` contains `/in/{publicId}/` AND
 * `commentCount > 0`).  Two filters, both load-bearing for the
 * lhremote#800 regression guards below:
 *
 * - The `/in/` filter excludes company posts, promoted slots, and edge
 *   feed items that legitimately yield `authorPublicId: null` and
 *   would trip the `authorPublicId !== null` regression guard.
 * - The `commentCount > 0` filter ensures the
 *   `commentCount > 0 → comments.length > 0` regression guard
 *   actually fires; without it, picking a comment-less post would
 *   silently bypass that check and leave broken comment scraping
 *   undetected.
 *
 * Returns `undefined` when no qualifying post is in the first 10 feed
 * items.
 */
async function fetchPostUrlFromFeed(cdpPort: number): Promise<string | undefined> {
  const { getFeed } = await import("@lhremote/core");
  const result = await getFeed({ cdpPort, count: 10 });
  for (const post of result.posts) {
    if (!post.url) continue;
    if (!post.authorProfileUrl?.includes("/in/")) continue;
    if (post.commentCount <= 0) continue;
    return post.url;
  }
  return undefined;
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

      // ── Structural assertions ──────────────────────────────────
      expect(parsed.post).toHaveProperty("postUrn");
      expect(typeof parsed.post.postUrn).toBe("string");
      expect(typeof parsed.post.authorName).toBe("string");
      expect(typeof parsed.post.reactionCount).toBe("number");
      expect(typeof parsed.post.commentCount).toBe("number");
      expect(typeof parsed.post.shareCount).toBe("number");
      expect(Array.isArray(parsed.comments)).toBe(true);
      expect(parsed.commentsPaging).toHaveProperty("total");

      // ── Semantic assertions (lhremote#800 regression guards) ───
      // The 2026-05 regression returned `authorName === "Premium"`,
      // empty text, and empty comments[] even when commentCount > 0.
      // These assertions catch that exact failure mode.

      // (1) authorName must NOT be a LinkedIn UI string (the regression's
      // signature value was "Premium" — the badge text from the Premium
      // upsell banner).
      const UI_STRING_BLOCKLIST = [
        "Premium",
        "Following",
        "Follow",
        "Connect",
        "Pending",
        "Comment",
        "Share",
        "Like",
        "Repost",
        "Send",
        "Save",
        "Report",
        "Promoted",
        "Boost",
      ];
      expect(parsed.post.authorName).not.toBe("");
      expect(UI_STRING_BLOCKLIST).not.toContain(parsed.post.authorName);

      // (2) authorPublicId must be set (the regression returned the
      // current user's publicId — without an account-publicId helper the
      // strict "!== currentAccountPublicId" check is deferred; use the
      // weaker "non-null" check here).
      expect(parsed.post.authorPublicId).not.toBeNull();

      // (3) Comments array must populate.  fetchPostUrlFromFeed
      // selected a post with commentCount > 0, so this assertion is
      // unconditional — the regression returned `comments: []` even
      // for posts with non-zero commentCount, and a conditional guard
      // would silently let comment-scraping regressions through if
      // the precondition ever drifted.
      expect(parsed.post.commentCount).toBeGreaterThan(0);
      expect(parsed.commentsPaging.total).toBeGreaterThan(0);
      expect(parsed.comments.length).toBeGreaterThan(0);

      // (4) Verify commentUrn extraction (was previously hardcoded to
      // null; SDUI format includes the `(urn:li:activity:` qualifier).
      if (parsed.comments.length > 0) {
        const firstComment = parsed.comments[0];
        expect(firstComment.commentUrn).not.toBeNull();
        expect(firstComment.commentUrn).toMatch(/^urn:li:comment:\(/);
      }
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
