// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, beforeAll, expect, it } from "vitest";
import {
  describeE2E,
  forceStopInstance,
  getE2EProfileUrl,
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
import type { HideFeedAuthorProfileOutput } from "@lhremote/core";

// MCP tool registrations
import { registerHideFeedAuthorProfile } from "@lhremote/mcp/tools";
import { createMockServer } from "@lhremote/mcp/testing";

describeE2E("hide-feed-author-profile operation", () => {
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

  it(
    "hide-feed-author-profile dryRun detects mute availability without muting",
    async () => {
      const profileUrl = getE2EProfileUrl();

      const { server, getHandler } = createMockServer();
      registerHideFeedAuthorProfile(server);
      const handler = getHandler("hide-feed-author-profile");

      const result = (await handler({
        profileUrl,
        cdpPort,
        dryRun: true,
      })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(
        result.isError,
        `MCP tool error: ${result.content[0]?.text ?? "no content"}`,
      ).toBeFalsy();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(
        (result.content[0] as { text: string }).text,
      ) as HideFeedAuthorProfileOutput;

      expect(parsed.profileUrl).toBe(profileUrl);
      expect(parsed.publicId.length).toBeGreaterThan(0);
      expect(parsed.dryRun).toBe(true);

      if (parsed.success) {
        // Mute is available — dryRun captured the name without muting.
        expect(parsed.muted).toBe(false);
        expect(parsed.hiddenName.length).toBeGreaterThan(0);
      } else {
        // Mute is not available on this profile (non-connection, blocked,
        // private) or the profile is already muted.
        expect(parsed.muted).toBe(false);
        expect(["mute_not_available", "already_muted"]).toContain(parsed.reason);
      }
    },
    180_000,
  );
});
