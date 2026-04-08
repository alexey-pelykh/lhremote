// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeE2E,
  forceStopInstance,
  getE2EPersonId,
  getE2EPostUrl,
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
  dismissErrors,
  LauncherService,
  startInstanceWithRecovery,
} from "@lhremote/core";
import type {
  VisitProfileOutput,
  EphemeralActionResult,
  ReactToPostOutput,
  CommentOnPostOutput,
} from "@lhremote/core";

// CLI handlers
import {
  handleVisitProfile,
  handleFollowPerson,
  handleEndorseSkills,
  handleLikePersonPosts,
  handleReactToPost,
  handleCommentOnPost,
} from "@lhremote/cli/handlers";

// MCP tool registrations
import {
  registerVisitProfile,
  registerFollowPerson,
  registerEndorseSkills,
  registerLikePersonPosts,
  registerReactToPost,
  registerCommentOnPost,
} from "@lhremote/mcp/tools";
import { createMockServer } from "@lhremote/mcp/testing";

describeE2E("engagement operations", () => {
  let app: AppService;
  let port: number;
  let accountId: number;
  let cdpPort: number;
  let personId: number;
  let postUrl: string;

  beforeAll(async () => {
    personId = getE2EPersonId();
    postUrl = getE2EPostUrl();

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

  // Dismiss any leftover error popups before each test to prevent cascade failures
  beforeEach(async () => {
    await dismissErrors({ cdpPort, accountId }).catch(() => {});
  }, 30_000);

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

  // ── visit-profile ─────────────────────────────────────────────────

  describe("visit-profile", () => {
    describe("CLI handlers", () => {
      const originalExitCode = process.exitCode;

      beforeEach(() => {
        process.exitCode = undefined;
      });

      afterEach(() => {
        process.exitCode = originalExitCode;
        vi.restoreAllMocks();
      });

      it("visit-profile --json returns profile data", async () => {
        const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
        const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

        await handleVisitProfile({ personId, cdpPort, accountId, json: true });

        const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
        expect(process.exitCode, `CLI handler error: ${stderr}`).toBeUndefined();
        expect(stdoutSpy).toHaveBeenCalled();

        const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
        const parsed = JSON.parse(output) as VisitProfileOutput;

        expect(parsed.success).toBe(true);
        expect(parsed.actionType).toBe("VisitAndExtract");
        expect(parsed.profile).toHaveProperty("id");
        expect(parsed.profile).toHaveProperty("miniProfile");
        expect(typeof parsed.profile.miniProfile.firstName).toBe("string");
      }, 120_000);
    });

    describe("MCP tools", () => {
      it("visit-profile tool returns valid JSON", async () => {
        const { server, getHandler } = createMockServer();
        registerVisitProfile(server);

        const handler = getHandler("visit-profile");
        const result = (await handler({ personId, cdpPort, accountId })) as {
          isError?: boolean;
          content: { type: string; text: string }[];
        };

        expect(result.isError, `MCP tool error: ${result.content?.[0]?.text}`).toBeUndefined();
        expect(result.content).toHaveLength(1);

        const parsed = JSON.parse(
          (result.content[0] as { text: string }).text,
        ) as VisitProfileOutput;

        expect(parsed.success).toBe(true);
        expect(parsed.actionType).toBe("VisitAndExtract");
        expect(parsed.profile).toHaveProperty("id");
        expect(parsed.profile).toHaveProperty("miniProfile");
      }, 120_000);
    });
  });

  // ── follow-person ─────────────────────────────────────────────────

  describe("follow-person", () => {
    describe("CLI handlers", () => {
      const originalExitCode = process.exitCode;

      beforeEach(() => {
        process.exitCode = undefined;
      });

      afterEach(() => {
        process.exitCode = originalExitCode;
        vi.restoreAllMocks();
      });

      it("follow-person --json returns action result", async () => {
        const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
        const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

        await handleFollowPerson({ personId, cdpPort, accountId, json: true });

        const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
        expect(process.exitCode, `CLI handler error: ${stderr}`).toBeUndefined();
        expect(stdoutSpy).toHaveBeenCalled();

        const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
        const parsed = JSON.parse(output) as EphemeralActionResult;

        expect(typeof parsed.success).toBe("boolean");
        expect(parsed.personId).toBe(personId);
      }, 120_000);
    });

    describe("MCP tools", () => {
      it("follow-person tool returns valid JSON", async () => {
        const { server, getHandler } = createMockServer();
        registerFollowPerson(server);

        const handler = getHandler("follow-person");
        const result = (await handler({ personId, cdpPort, accountId })) as {
          isError?: boolean;
          content: { type: string; text: string }[];
        };

        expect(result.isError, `MCP tool error: ${result.content?.[0]?.text}`).toBeUndefined();
        expect(result.content).toHaveLength(1);

        const parsed = JSON.parse(
          (result.content[0] as { text: string }).text,
        ) as EphemeralActionResult;

        expect(typeof parsed.success).toBe("boolean");
        expect(parsed.personId).toBe(personId);
      }, 120_000);
    });
  });

  // ── endorse-skills ────────────────────────────────────────────────

  describe("endorse-skills", () => {
    describe("CLI handlers", () => {
      const originalExitCode = process.exitCode;

      beforeEach(() => {
        process.exitCode = undefined;
      });

      afterEach(() => {
        process.exitCode = originalExitCode;
        vi.restoreAllMocks();
      });

      it("endorse-skills --json returns action result", async () => {
        const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
        const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

        await handleEndorseSkills({ personId, cdpPort, accountId, json: true });

        const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
        expect(process.exitCode, `CLI handler error: ${stderr}`).toBeUndefined();
        expect(stdoutSpy).toHaveBeenCalled();

        const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
        const parsed = JSON.parse(output) as EphemeralActionResult;

        expect(typeof parsed.success).toBe("boolean");
        expect(parsed.personId).toBe(personId);
      }, 120_000);
    });

    describe("MCP tools", () => {
      it("endorse-skills tool returns valid JSON", async () => {
        const { server, getHandler } = createMockServer();
        registerEndorseSkills(server);

        const handler = getHandler("endorse-skills");
        const result = (await handler({ personId, cdpPort, accountId })) as {
          isError?: boolean;
          content: { type: string; text: string }[];
        };

        expect(result.isError, `MCP tool error: ${result.content?.[0]?.text}`).toBeUndefined();
        expect(result.content).toHaveLength(1);

        const parsed = JSON.parse(
          (result.content[0] as { text: string }).text,
        ) as EphemeralActionResult;

        expect(typeof parsed.success).toBe("boolean");
        expect(parsed.personId).toBe(personId);
      }, 120_000);
    });
  });

  // ── like-person-posts ─────────────────────────────────────────────

  describe("like-person-posts", () => {
    describe("CLI handlers", () => {
      const originalExitCode = process.exitCode;

      beforeEach(() => {
        process.exitCode = undefined;
      });

      afterEach(() => {
        process.exitCode = originalExitCode;
        vi.restoreAllMocks();
      });

      it("like-person-posts --json returns action result", async () => {
        const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
        const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

        await handleLikePersonPosts({
          personId,
          numberOfPosts: 1,
          timeout: 90_000,
          cdpPort,
          accountId,
          json: true,
        });

        const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
        expect(process.exitCode, `CLI handler error: ${stderr}`).toBeUndefined();
        expect(stdoutSpy).toHaveBeenCalled();

        const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
        const parsed = JSON.parse(output) as EphemeralActionResult;

        expect(typeof parsed.success).toBe("boolean");
        expect(parsed.personId).toBe(personId);
      }, 120_000);
    });

    describe("MCP tools", () => {
      it("like-person-posts tool returns valid JSON", async () => {
        const { server, getHandler } = createMockServer();
        registerLikePersonPosts(server);

        const handler = getHandler("like-person-posts");
        const result = (await handler({
          personId,
          numberOfPosts: 1,
          timeout: 90_000,
          cdpPort,
          accountId,
        })) as {
          isError?: boolean;
          content: { type: string; text: string }[];
        };

        expect(result.isError, `MCP tool error: ${result.content?.[0]?.text}`).toBeUndefined();
        expect(result.content).toHaveLength(1);

        const parsed = JSON.parse(
          (result.content[0] as { text: string }).text,
        ) as EphemeralActionResult;

        expect(typeof parsed.success).toBe("boolean");
        expect(parsed.personId).toBe(personId);
      }, 120_000);
    });
  });

  // ── react-to-post ─────────────────────────────────────────────────

  describe("react-to-post", () => {
    describe("CLI handlers", () => {
      const originalExitCode = process.exitCode;

      beforeEach(() => {
        process.exitCode = undefined;
      });

      afterEach(() => {
        process.exitCode = originalExitCode;
        vi.restoreAllMocks();
      });

      it("react-to-post --json returns reaction result", async () => {
        const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
        const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

        await handleReactToPost(postUrl, { cdpPort, json: true });

        const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
        expect(process.exitCode, `CLI handler error: ${stderr}`).toBeUndefined();
        expect(stdoutSpy).toHaveBeenCalled();

        const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
        const parsed = JSON.parse(output) as ReactToPostOutput;

        expect(parsed.success).toBe(true);
        expect(parsed.postUrl).toBe(postUrl);
        expect(typeof parsed.reactionType).toBe("string");
      }, 120_000);
    });

    describe("MCP tools", () => {
      it("react-to-post tool returns valid JSON", async () => {
        const { server, getHandler } = createMockServer();
        registerReactToPost(server);

        const handler = getHandler("react-to-post");
        const result = (await handler({
          postUrl,
          reactionType: "like",
          cdpPort,
        })) as {
          isError?: boolean;
          content: { type: string; text: string }[];
        };

        expect(result.isError, `MCP tool error: ${result.content?.[0]?.text}`).toBeUndefined();
        expect(result.content).toHaveLength(1);

        const parsed = JSON.parse(
          (result.content[0] as { text: string }).text,
        ) as ReactToPostOutput;

        expect(parsed.success).toBe(true);
        expect(parsed.postUrl).toBe(postUrl);
        expect(parsed.reactionType).toBe("like");
      }, 120_000);
    });
  });

  // ── comment-on-post ───────────────────────────────────────────────

  describe("comment-on-post", () => {
    describe("CLI handlers", () => {
      const originalExitCode = process.exitCode;

      beforeEach(() => {
        process.exitCode = undefined;
      });

      afterEach(() => {
        process.exitCode = originalExitCode;
        vi.restoreAllMocks();
      });

      it("comment-on-post --json returns comment result", async () => {
        const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
        const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

        await handleCommentOnPost({
          url: postUrl,
          text: "E2E test comment",
          cdpPort,
          accountId,
          json: true,
        });

        const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
        expect(process.exitCode, `CLI handler error: ${stderr}`).toBeUndefined();
        expect(stdoutSpy).toHaveBeenCalled();

        const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
        const parsed = JSON.parse(output) as CommentOnPostOutput;

        expect(parsed.success).toBe(true);
        expect(parsed.postUrl).toBe(postUrl);
        expect(parsed.commentText).toBe("E2E test comment");
      }, 120_000);
    });

    describe("MCP tools", () => {
      it("comment-on-post tool returns valid JSON", async () => {
        const { server, getHandler } = createMockServer();
        registerCommentOnPost(server);

        const handler = getHandler("comment-on-post");
        const result = (await handler({
          postUrl,
          text: "E2E test comment",
          cdpPort,
          accountId,
        })) as {
          isError?: boolean;
          content: { type: string; text: string }[];
        };

        expect(result.isError, `MCP tool error: ${result.content?.[0]?.text}`).toBeUndefined();
        expect(result.content).toHaveLength(1);

        const parsed = JSON.parse(
          (result.content[0] as { text: string }).text,
        ) as CommentOnPostOutput;

        expect(parsed.success).toBe(true);
        expect(parsed.postUrl).toBe(postUrl);
        expect(parsed.commentText).toBe("E2E test comment");
      }, 120_000);
    });
  });
});
