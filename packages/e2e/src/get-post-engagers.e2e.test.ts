// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertDefined, describeE2E, forceStopInstance, launchApp, quitApp, resolveAccountId, retryAsync } from "@lhremote/core/testing";
import {
  type AppService,
  discoverInstancePort,
  discoverTargets,
  LauncherService,
  startInstanceWithRecovery,
} from "@lhremote/core";
import type { GetFeedOutput, GetPostEngagersOutput, PostEngager } from "@lhremote/core";

// MCP tool registrations
import { registerGetFeed, registerGetPostEngagers } from "@lhremote/mcp/tools";
import { createMockServer } from "@lhremote/mcp/testing";

describeE2E("get-post-engagers operation", () => {
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

  describe("MCP tools", () => {
    it("get-post-engagers tool returns valid JSON", async () => {
      // Dynamically fetch a post with reactions from the feed
      const feedServer = createMockServer();
      registerGetFeed(feedServer.server);
      const feedHandler = feedServer.getHandler("get-feed");
      const feedResult = (await feedHandler({ cdpPort, count: 5 })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };
      expect(feedResult.isError, "get-feed failed — cannot test engagers without a post").toBeUndefined();
      const feedParsed = JSON.parse(
        (feedResult.content[0] as { text: string }).text,
      ) as GetFeedOutput;

      // Pick first post with reactions > 0; fall back to first post.
      // Which branch was taken is what tells an empty-engagers failure
      // apart from an extraction regression, so keep the picked post
      // itself — the precondition below reports its reactionCount.
      const postWithReactions = feedParsed.posts.find((p) => p.reactionCount > 0);
      const pickedPost = postWithReactions ?? feedParsed.posts[0];
      const postUrl = pickedPost?.url;
      assertDefined(postUrl, "No posts returned from get-feed");

      const { server, getHandler } = createMockServer();
      registerGetPostEngagers(server);

      const handler = getHandler("get-post-engagers");
      const result = (await handler({ postUrl: postUrl, cdpPort, count: 5 })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(result.isError, `MCP tool error: ${result.content?.[0]?.text}`).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(
        (result.content[0] as { text: string }).text,
      ) as GetPostEngagersOutput;

      expect(parsed).toHaveProperty("postUrn");
      expect(Array.isArray(parsed.engagers)).toBe(true);
      expect(parsed.paging).toHaveProperty("total");

      // Precondition, not a guard: a conditional here passes vacuously
      // when extraction returns nothing (lhremote#829).  Zero engagers has
      // two very different causes, and the pick above already settles
      // which one applies — `find` misses only when no fetched post had
      // reactions — so report the picked post's own reactionCount instead
      // of leaving a red build to guess.  The reactions-modal path is
      // still unprobed (lhremote#830).
      expect(
        parsed.engagers.length,
        `precondition: expected at least one engager for ${postUrl} — got 0. ` +
          `get-feed reported reactionCount=${String(pickedPost?.reactionCount)} for that post: ` +
          "0 means no fetched post had reactions and the test fell back to posts[0] " +
          "(fixture problem — re-run against a feed that has reactions), " +
          "while >0 means engager extraction regressed",
      ).toBeGreaterThan(0);

      const engager = parsed.engagers[0] as PostEngager;
      expect(typeof engager.firstName).toBe("string");
      expect(typeof engager.lastName).toBe("string");
      expect(typeof engager.engagementType).toBe("string");
    }, 120_000);
  });
});
