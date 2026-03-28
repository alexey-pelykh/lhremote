// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import type { GetFeedOutput, GetPostEngagersOutput } from "@lhremote/core";

// MCP tool registrations
import { registerGetFeed, registerGetPostEngagers } from "@lhremote/mcp/tools";
import { createMockServer } from "@lhremote/mcp/testing";

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

describeE2E("get-post-engagers operation", () => {
  let app: AppService;
  let port: number;
  let accountId: number | undefined;
  let cdpPort: number;

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

      // Pick first post with reactions > 0; fall back to first post
      const postWithReactions = feedParsed.posts.find((p) => p.reactionCount > 0);
      const postUrn = postWithReactions?.urn ?? feedParsed.posts[0]?.urn;
      assertDefined(postUrn, "No posts returned from get-feed");

      const { server, getHandler } = createMockServer();
      registerGetPostEngagers(server);

      const handler = getHandler("get-post-engagers");
      const result = (await handler({ postUrl: postUrn, cdpPort, count: 5 })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(
        (result.content[0] as { text: string }).text,
      ) as GetPostEngagersOutput;

      expect(parsed).toHaveProperty("postUrn");
      expect(Array.isArray(parsed.engagers)).toBe(true);
      expect(parsed.paging).toHaveProperty("total");

      if (parsed.engagers.length > 0) {
        const engager = parsed.engagers[0] as (typeof parsed.engagers)[0];
        expect(typeof engager.firstName).toBe("string");
        expect(typeof engager.lastName).toBe("string");
        expect(typeof engager.engagementType).toBe("string");
      }
    }, 120_000);
  });
});
