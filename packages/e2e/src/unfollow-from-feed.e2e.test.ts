// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, beforeAll, expect, it } from "vitest";
import {
  describeE2E,
  forceStopInstance,
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
  LauncherService,
  startInstanceWithRecovery,
} from "@lhremote/core";
import type { UnfollowFromFeedOutput } from "@lhremote/core";

// MCP tool registrations
import { registerUnfollowFromFeed } from "@lhremote/mcp/tools";
import { createMockServer } from "@lhremote/mcp/testing";

describeE2E("unfollow-from-feed operation", () => {
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

    const instancePort = await retryAsync(
      async () => {
        const p = await discoverInstancePort(port);
        if (p === null) throw new Error("Instance CDP port not discovered yet");
        return p;
      },
      { retries: 10, delay: 2_000 },
    );
    cdpPort = instancePort;

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

  it("unfollow-from-feed dryRun finds a non-own post and verifies menu item", async () => {
    const { server, getHandler } = createMockServer();
    registerUnfollowFromFeed(server);
    const handler = getHandler("unfollow-from-feed");

    const MAX_INDEX = 5;
    let found = false;

    for (let i = 0; i < MAX_INDEX; i++) {
      const result = (await handler({
        feedIndex: i,
        cdpPort,
        dryRun: true,
      })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(result.content).toHaveLength(1);
      const text = (result.content[0] as { text: string }).text;

      if (result.isError) {
        // This post doesn't have "Unfollow" (own post, etc.) — try next
        console.log(`[info] Feed index ${i}: no Unfollow — ${text.slice(0, 120)}`);
        continue;
      }

      const parsed = JSON.parse(text) as UnfollowFromFeedOutput;
      expect(parsed.success).toBe(true);
      expect(parsed.feedIndex).toBe(i);
      expect(parsed.dryRun).toBe(true);
      expect(typeof parsed.unfollowedName).toBe("string");
      expect(parsed.unfollowedName.length).toBeGreaterThan(0);
      console.log(`[info] Feed index ${i}: Unfollow available for "${parsed.unfollowedName}"`);
      found = true;
      break;
    }

    expect(found, `No feed post in indices 0–${MAX_INDEX - 1} has an "Unfollow" menu item`).toBe(true);
  }, 180_000);
});
