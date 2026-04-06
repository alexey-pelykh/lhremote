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
import type { GetProfileActivityOutput } from "@lhremote/core";

// CLI handlers
import { handleGetProfileActivity } from "@lhremote/cli/handlers";

// MCP tool registrations
import { registerGetProfileActivity } from "@lhremote/mcp/tools";
import { createMockServer } from "@lhremote/mcp/testing";

/**
 * Fetch a profile public ID by reading the first feed post's author URL.
 * Extracts the vanity slug from URLs like `https://www.linkedin.com/in/janesmith`.
 */
async function fetchProfilePublicIdFromFeed(cdpPort: number): Promise<string | undefined> {
  const { getFeed } = await import("@lhremote/core");
  const result = await getFeed({ cdpPort, count: 5 });
  for (const post of result.posts) {
    const url = post.authorProfileUrl;
    if (!url) continue;
    const match = url.match(/\/in\/([^/?]+)/);
    if (match) return match[1];
  }
  return undefined;
}

describeE2E("get-profile-activity operation", () => {
  let app: AppService;
  let port: number;
  let accountId: number;
  let cdpPort: number;
  let profilePublicId: string | undefined;

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

    // Fetch a profile public ID from the first feed post's author
    profilePublicId = await fetchProfilePublicIdFromFeed(cdpPort);
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
  }, 120_000);

  describe("CLI handlers", () => {
    const originalExitCode = process.exitCode;

    beforeEach(() => {
      process.exitCode = undefined;
    });

    afterEach(() => {
      process.exitCode = originalExitCode;
      vi.restoreAllMocks();
    });

    it("get-profile-activity --json returns recent activity", async () => {
      assertDefined(profilePublicId, "No profile public ID — feed returned no posts with author URLs");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleGetProfileActivity(profilePublicId, {
        cdpPort,
        count: 5,
        json: true,
      });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      const parsed = JSON.parse(output) as GetProfileActivityOutput;

      expect(parsed.profilePublicId).toBe(profilePublicId);
      expect(Array.isArray(parsed.posts)).toBe(true);

      // Profile may or may not have recent posts
      for (const post of parsed.posts) {
        expect(post).toHaveProperty("url");
        expect(typeof post.reactionCount).toBe("number");
        expect(typeof post.commentCount).toBe("number");
        expect(typeof post.shareCount).toBe("number");
      }
    }, 120_000);

    it("get-profile-activity prints human-friendly output", async () => {
      assertDefined(profilePublicId, "No profile public ID — feed returned no posts with author URLs");

      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleGetProfileActivity(profilePublicId, {
        cdpPort,
        count: 3,
      });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      expect(output).toContain("Profile:");
      expect(output).toContain(profilePublicId);
    }, 120_000);
  });

  describe("MCP tools", () => {
    it("get-profile-activity tool returns valid JSON", async () => {
      assertDefined(profilePublicId, "No profile public ID — feed returned no posts with author URLs");

      const { server, getHandler } = createMockServer();
      registerGetProfileActivity(server);

      const handler = getHandler("get-profile-activity");
      const result = (await handler({
        profile: profilePublicId,
        count: 5,
        cdpPort,
      })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(result.isError, `MCP tool error: ${result.content?.[0]?.text}`).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(
        (result.content[0] as { text: string }).text,
      ) as GetProfileActivityOutput;

      expect(parsed.profilePublicId).toBe(profilePublicId);
      expect(Array.isArray(parsed.posts)).toBe(true);
    }, 120_000);
  });
});
