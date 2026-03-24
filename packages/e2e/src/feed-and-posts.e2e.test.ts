// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { describeE2E, launchApp, quitApp, retryAsync } from "@lhremote/core/testing";
import {
  type Account,
  type AppService,
  discoverInstancePort,
  getFeed,
  killInstanceProcesses,
  LauncherService,
  startInstanceWithRecovery,
  waitForInstanceShutdown,
} from "@lhremote/core";
import type {
  FeedPost,
  GetFeedOutput,
  GetPostOutput,
  GetPostStatsOutput,
  GetProfileActivityOutput,
  SearchPostsOutput,
} from "@lhremote/core";

// CLI handlers
import {
  handleGetFeed,
  handleGetPost,
  handleGetPostStats,
  handleGetProfileActivity,
  handleSearchPosts,
} from "@lhremote/cli/handlers";

// MCP tool registrations
import {
  registerGetFeed,
  registerGetPost,
  registerGetPostStats,
  registerGetProfileActivity,
  registerSearchPosts,
} from "@lhremote/mcp/tools";
import { createMockServer } from "@lhremote/mcp/testing";

/**
 * Test contact public ID for get-profile-activity tests.
 * Read from `LHREMOTE_E2E_PROFILE_PUBLIC_ID` — must be a LinkedIn vanity slug.
 */
function getTestProfilePublicId(): string {
  const raw = process.env.LHREMOTE_E2E_PROFILE_PUBLIC_ID;
  if (!raw) throw new Error("LHREMOTE_E2E_PROFILE_PUBLIC_ID must be set");
  return raw;
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

describeE2E("feed and posts operations", () => {
  let app: AppService;
  let port: number;
  let accountId: number | undefined;

  beforeAll(async () => {
    const launched = await launchApp();
    app = launched.app;
    port = launched.port;

    const launcher = new LauncherService(port);
    await retryAsync(() => launcher.connect(), { retries: 3, delay: 1_000 });
    const accounts = await launcher.listAccounts();

    if (accounts.length > 0) {
      accountId = (accounts[0] as Account).id;
    }

    launcher.disconnect();
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

  // -----------------------------------------------------------------------
  // Instance running — all feed/post operations require a LinkedIn session
  // -----------------------------------------------------------------------

  describe("with instance running", () => {
    /** Captured from get-feed to reuse for post-detail operations. */
    let capturedPostUrn: string | undefined;

    /** Instance CDP port — where the LinkedIn WebView lives. */
    let cdpPort: number;

    beforeAll(async () => {
      if (accountId === undefined) return;

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

      // Wait for the LinkedIn WebView AND Voyager API to become available.
      // The LinkedIn SPA takes time to load after instance start; we retry
      // a lightweight get-feed call until it succeeds.
      await retryAsync(
        async () => {
          await getFeed({ count: 1, cdpPort });
        },
        { retries: 30, delay: 3_000 },
      );
    }, 300_000);

    afterAll(async () => {
      if (accountId === undefined) return;

      const launcher = new LauncherService(port);
      try {
        await launcher.connect();
        await forceStopInstance(launcher, accountId, port);
      } catch {
        // Best-effort cleanup
      } finally {
        launcher.disconnect();
      }
    }, 60_000);

    // -----------------------------------------------------------------
    // get-feed
    // -----------------------------------------------------------------

    describe("get-feed", () => {
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
          expect(post).toHaveProperty("urn");
          expect(typeof post.urn).toBe("string");
          expect(typeof post.reactionCount).toBe("number");
          expect(typeof post.commentCount).toBe("number");
          expect(typeof post.shareCount).toBe("number");
          expect(Array.isArray(post.hashtags)).toBe(true);

          // Capture a post URN for downstream tests
          capturedPostUrn = post.urn;
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

          expect(result.isError).toBeUndefined();
          expect(result.content).toHaveLength(1);

          const parsed = JSON.parse(
            (result.content[0] as { text: string }).text,
          ) as GetFeedOutput;

          expect(Array.isArray(parsed.posts)).toBe(true);
          expect(parsed.posts.length).toBeGreaterThan(0);

          const post = parsed.posts[0] as FeedPost;
          expect(post).toHaveProperty("urn");
          expect(typeof post.reactionCount).toBe("number");

          // Ensure capturedPostUrn is set even if CLI test was skipped
          if (!capturedPostUrn) {
            capturedPostUrn = post.urn;
          }
        }, 60_000);
      });
    });

    // -----------------------------------------------------------------
    // get-post
    // -----------------------------------------------------------------

    describe("get-post", () => {
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
          assertDefined(capturedPostUrn, "No post URN captured from get-feed");

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
          assertDefined(capturedPostUrn, "No post URN captured from get-feed");

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
          assertDefined(capturedPostUrn, "No post URN captured from get-feed");

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

    // NOTE: get-post-engagers (#506) is omitted because LinkedIn fully
    // deprecated its Voyager endpoint.

    // -----------------------------------------------------------------
    // get-post-stats (passive interception of /feed/updates/{urn})
    // -----------------------------------------------------------------

    describe("get-post-stats", () => {
      describe("CLI handlers", () => {
        const originalExitCode = process.exitCode;

        beforeEach(() => {
          process.exitCode = undefined;
        });

        afterEach(() => {
          process.exitCode = originalExitCode;
          vi.restoreAllMocks();
        });

        it("get-post-stats --json returns valid stats", async () => {
          assertDefined(capturedPostUrn, "No post URN captured from get-feed");

          const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockReturnValue(true);

          await handleGetPostStats(capturedPostUrn, { cdpPort, json: true });

          expect(process.exitCode).toBeUndefined();
          expect(stdoutSpy).toHaveBeenCalled();

          const output = stdoutSpy.mock.calls
            .map((call) => String(call[0]))
            .join("");
          const parsed = JSON.parse(output) as GetPostStatsOutput;

          expect(parsed.stats).toHaveProperty("postUrn");
          expect(typeof parsed.stats.reactionCount).toBe("number");
          expect(Array.isArray(parsed.stats.reactionsByType)).toBe(true);
          expect(typeof parsed.stats.commentCount).toBe("number");
          expect(typeof parsed.stats.shareCount).toBe("number");
        }, 60_000);

        it("get-post-stats prints human-friendly output", async () => {
          assertDefined(capturedPostUrn, "No post URN captured from get-feed");

          const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockReturnValue(true);

          await handleGetPostStats(capturedPostUrn, { cdpPort });

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
        it("get-post-stats tool returns valid JSON", async () => {
          assertDefined(capturedPostUrn, "No post URN captured from get-feed");

          const { server, getHandler } = createMockServer();
          registerGetPostStats(server);

          const handler = getHandler("get-post-stats");
          const result = (await handler({ postUrl: capturedPostUrn, cdpPort })) as {
            isError?: boolean;
            content: { type: string; text: string }[];
          };

          expect(result.isError).toBeUndefined();
          expect(result.content).toHaveLength(1);

          const parsed = JSON.parse(
            (result.content[0] as { text: string }).text,
          ) as GetPostStatsOutput;

          expect(parsed.stats).toHaveProperty("postUrn");
          expect(typeof parsed.stats.reactionCount).toBe("number");
          expect(Array.isArray(parsed.stats.reactionsByType)).toBe(true);
        }, 60_000);
      });
    });

    // -----------------------------------------------------------------
    // search-posts
    // -----------------------------------------------------------------

    // Skipped: search-posts passive interception fails in LH webview (#522)
    describe.skip("search-posts", () => {
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
          expect(parsed.paging).toHaveProperty("total");

          const post = parsed.posts[0] as (typeof parsed.posts)[number];
          expect(post).toHaveProperty("postUrn");
          expect(typeof post.reactionCount).toBe("number");
          expect(typeof post.commentCount).toBe("number");
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
          expect(output).toContain("results");
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

          expect(result.isError).toBeUndefined();
          expect(result.content).toHaveLength(1);

          const parsed = JSON.parse(
            (result.content[0] as { text: string }).text,
          ) as SearchPostsOutput;

          expect(parsed.query).toBe("linkedin");
          expect(Array.isArray(parsed.posts)).toBe(true);
          expect(parsed.posts.length).toBeGreaterThan(0);
          expect(parsed.paging).toHaveProperty("total");
        }, 60_000);
      });
    });

    // -----------------------------------------------------------------
    // get-profile-activity
    // -----------------------------------------------------------------

    describe("get-profile-activity", () => {
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
          const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockReturnValue(true);

          await handleGetProfileActivity(getTestProfilePublicId(), {
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

          expect(parsed.profilePublicId).toBe(getTestProfilePublicId());
          expect(Array.isArray(parsed.posts)).toBe(true);
          expect(parsed.paging).toHaveProperty("total");

          // Profile may or may not have recent posts
          for (const post of parsed.posts) {
            expect(post).toHaveProperty("urn");
            expect(typeof post.reactionCount).toBe("number");
            expect(typeof post.commentCount).toBe("number");
            expect(typeof post.shareCount).toBe("number");
          }
        }, 60_000);

        it("get-profile-activity prints human-friendly output", async () => {
          const stdoutSpy = vi
            .spyOn(process.stdout, "write")
            .mockReturnValue(true);

          await handleGetProfileActivity(getTestProfilePublicId(), {
            cdpPort,
            count: 3,
          });

          expect(process.exitCode).toBeUndefined();
          expect(stdoutSpy).toHaveBeenCalled();

          const output = stdoutSpy.mock.calls
            .map((call) => String(call[0]))
            .join("");
          expect(output).toContain("Profile:");
          expect(output).toContain(getTestProfilePublicId());
        }, 60_000);
      });

      describe("MCP tools", () => {
        it("get-profile-activity tool returns valid JSON", async () => {
          const { server, getHandler } = createMockServer();
          registerGetProfileActivity(server);

          const handler = getHandler("get-profile-activity");
          const result = (await handler({
            profile: getTestProfilePublicId(),
            count: 5,
            cdpPort,
          })) as {
            isError?: boolean;
            content: { type: string; text: string }[];
          };

          expect(result.isError).toBeUndefined();
          expect(result.content).toHaveLength(1);

          const parsed = JSON.parse(
            (result.content[0] as { text: string }).text,
          ) as GetProfileActivityOutput;

          expect(parsed.profilePublicId).toBe(getTestProfilePublicId());
          expect(Array.isArray(parsed.posts)).toBe(true);
          expect(parsed.paging).toHaveProperty("total");
        }, 60_000);
      });
    });
  });
});
