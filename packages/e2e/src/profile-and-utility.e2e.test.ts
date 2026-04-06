// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeE2E,
  forceStopInstance,
  getE2EPersonId,
  installErrorDetection,
  launchApp,
  quitApp,
  resolveAccountId,
  retryAsync,
} from "@lhremote/core/testing";
import {
  type AppService,
  LauncherService,
  startInstanceWithRecovery,
} from "@lhremote/core";

// CLI handlers
import {
  handleBuildUrl,
  handleDescribeActions,
  handleEnrichProfile,
  handleGetActionBudget,
  handleGetThrottleStatus,
  handleListReferenceData,
  handleQueryProfilesBulk,
  handleResolveEntity,
} from "@lhremote/cli/handlers";

// MCP tool registrations
import {
  registerBuildLinkedInUrl,
  registerDescribeActions,
  registerEnrichProfile,
  registerGetActionBudget,
  registerGetThrottleStatus,
  registerListLinkedInReferenceData,
  registerQueryProfilesBulk,
  registerResolveLinkedInEntity,
} from "@lhremote/mcp/tools";
import { createMockServer } from "@lhremote/mcp/testing";

describeE2E("profile enrichment and utilities", () => {
  // ── describe-actions ─────────────────────────────────────────────

  describe("describe-actions", () => {
    describe("CLI handler", () => {
      const originalExitCode = process.exitCode;

      beforeEach(() => {
        process.exitCode = undefined;
      });

      afterEach(() => {
        process.exitCode = originalExitCode;
        vi.restoreAllMocks();
      });

      it("lists all action types --json", () => {
        const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

        handleDescribeActions({ json: true });

        expect(process.exitCode).toBeUndefined();
        expect(stdoutSpy).toHaveBeenCalled();

        const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
        const parsed = JSON.parse(output) as {
          actionTypes: { name: string; category: string; description: string }[];
        };

        expect(parsed.actionTypes.length).toBeGreaterThan(0);
        expect(parsed.actionTypes[0]).toHaveProperty("name");
        expect(parsed.actionTypes[0]).toHaveProperty("category");
        expect(parsed.actionTypes[0]).toHaveProperty("description");
      });

      it("returns details for a specific action type --json", () => {
        const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

        handleDescribeActions({ type: "VisitAndExtract", json: true });

        expect(process.exitCode).toBeUndefined();
        expect(stdoutSpy).toHaveBeenCalled();

        const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
        const parsed = JSON.parse(output) as {
          name: string;
          category: string;
          description: string;
          configSchema: Record<string, unknown>;
        };

        expect(parsed.name).toBe("VisitAndExtract");
        expect(typeof parsed.category).toBe("string");
        expect(typeof parsed.description).toBe("string");
        expect(typeof parsed.configSchema).toBe("object");
      });
    });

    describe("MCP tool", () => {
      it("returns action type catalog", async () => {
        const { server, getHandler } = createMockServer();
        registerDescribeActions(server);

        const handler = getHandler("describe-actions");
        const result = (await handler({})) as {
          isError?: boolean;
          content: { type: string; text: string }[];
        };

        expect(result.isError, `MCP tool error: ${result.content?.[0]?.text}`).toBeUndefined();
        expect(result.content).toHaveLength(1);

        const parsed = JSON.parse((result.content[0] as { text: string }).text) as {
          actionTypes: { name: string; category: string; description: string }[];
        };

        expect(parsed.actionTypes.length).toBeGreaterThan(0);
        expect(parsed.actionTypes[0]).toHaveProperty("name");
      });

      it("returns details for a specific action type", async () => {
        const { server, getHandler } = createMockServer();
        registerDescribeActions(server);

        const handler = getHandler("describe-actions");
        const result = (await handler({ actionType: "VisitAndExtract" })) as {
          isError?: boolean;
          content: { type: string; text: string }[];
        };

        expect(result.isError, `MCP tool error: ${result.content?.[0]?.text}`).toBeUndefined();
        expect(result.content).toHaveLength(1);

        const parsed = JSON.parse((result.content[0] as { text: string }).text) as {
          name: string;
          category: string;
          configSchema: Record<string, unknown>;
        };

        expect(parsed.name).toBe("VisitAndExtract");
        expect(typeof parsed.configSchema).toBe("object");
      });
    });
  });

  // ── list-linkedin-reference-data ──────────────────────────────────

  describe("list-linkedin-reference-data", () => {
    describe("CLI handler", () => {
      const originalExitCode = process.exitCode;

      beforeEach(() => {
        process.exitCode = undefined;
      });

      afterEach(() => {
        process.exitCode = originalExitCode;
        vi.restoreAllMocks();
      });

      it("lists INDUSTRY reference data --json", () => {
        const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

        handleListReferenceData("INDUSTRY", { json: true });

        expect(process.exitCode).toBeUndefined();
        expect(stdoutSpy).toHaveBeenCalled();

        const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
        const parsed = JSON.parse(output) as {
          dataType: string;
          items: unknown[];
        };

        expect(parsed.dataType).toBe("INDUSTRY");
        expect(parsed.items.length).toBeGreaterThan(0);
      });
    });

    describe("MCP tool", () => {
      it("returns reference data entries", async () => {
        const { server, getHandler } = createMockServer();
        registerListLinkedInReferenceData(server);

        const handler = getHandler("list-linkedin-reference-data");
        const result = (await handler({ dataType: "INDUSTRY" })) as {
          isError?: boolean;
          content: { type: string; text: string }[];
        };

        expect(result.isError, `MCP tool error: ${result.content?.[0]?.text}`).toBeUndefined();
        expect(result.content).toHaveLength(1);

        const parsed = JSON.parse((result.content[0] as { text: string }).text) as {
          dataType: string;
          items: unknown[];
        };

        expect(parsed.dataType).toBe("INDUSTRY");
        expect(parsed.items.length).toBeGreaterThan(0);
      });
    });
  });

  // ── build-linkedin-url ────────────────────────────────────────────

  describe("build-linkedin-url", () => {
    describe("CLI handler", () => {
      const originalExitCode = process.exitCode;

      beforeEach(() => {
        process.exitCode = undefined;
      });

      afterEach(() => {
        process.exitCode = originalExitCode;
        vi.restoreAllMocks();
      });

      it("builds a SearchPage URL with keywords --json", () => {
        const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

        handleBuildUrl("SearchPage", { keywords: "software engineer", json: true });

        expect(process.exitCode).toBeUndefined();
        expect(stdoutSpy).toHaveBeenCalled();

        const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
        const parsed = JSON.parse(output) as {
          url: string;
          sourceType: string;
          warnings: string[];
        };

        expect(parsed.url).toContain("linkedin.com");
        expect(parsed.sourceType).toBe("SearchPage");
        expect(Array.isArray(parsed.warnings)).toBe(true);
      });

      it("builds a MyConnections fixed URL --json", () => {
        const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

        handleBuildUrl("MyConnections", { json: true });

        expect(process.exitCode).toBeUndefined();
        expect(stdoutSpy).toHaveBeenCalled();

        const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
        const parsed = JSON.parse(output) as {
          url: string;
          sourceType: string;
          warnings: string[];
        };

        expect(parsed.url).toContain("linkedin.com");
        expect(parsed.sourceType).toBe("MyConnections");
      });
    });

    describe("MCP tool", () => {
      it("builds a SearchPage URL with keywords", async () => {
        const { server, getHandler } = createMockServer();
        registerBuildLinkedInUrl(server);

        const handler = getHandler("build-linkedin-url");
        const result = (await handler({
          sourceType: "SearchPage",
          keywords: "software engineer",
        })) as {
          isError?: boolean;
          content: { type: string; text: string }[];
        };

        expect(result.isError, `MCP tool error: ${result.content?.[0]?.text}`).toBeUndefined();
        expect(result.content).toHaveLength(1);

        const parsed = JSON.parse((result.content[0] as { text: string }).text) as {
          url: string;
          sourceType: string;
          warnings: string[];
        };

        expect(parsed.url).toContain("linkedin.com");
        expect(parsed.sourceType).toBe("SearchPage");
        expect(Array.isArray(parsed.warnings)).toBe(true);
      });
    });
  });

  // ── query-profiles-bulk ───────────────────────────────────────────

  describe("query-profiles-bulk", () => {
    describe("CLI handler", () => {
      const originalExitCode = process.exitCode;

      beforeEach(() => {
        process.exitCode = undefined;
      });

      afterEach(() => {
        process.exitCode = originalExitCode;
        vi.restoreAllMocks();
      });

      it("looks up profiles by publicId --json", async () => {
        const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

        await handleQueryProfilesBulk({ publicId: ["williamhgates"], json: true });

        expect(process.exitCode).toBeUndefined();
        expect(stdoutSpy).toHaveBeenCalled();

        const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
        const parsed = JSON.parse(output) as {
          byPublicId: ({ id: number; miniProfile: { firstName: string } } | null)[];
        };

        expect(parsed.byPublicId).toHaveLength(1);
        expect(parsed.byPublicId[0]).not.toBeNull();
        expect((parsed.byPublicId[0] as { miniProfile: { firstName: string } }).miniProfile.firstName.length).toBeGreaterThan(0);
      });
    });

    describe("MCP tool", () => {
      it("looks up profiles by publicIds", async () => {
        const { server, getHandler } = createMockServer();
        registerQueryProfilesBulk(server);

        const handler = getHandler("query-profiles-bulk");
        const result = (await handler({ publicIds: ["williamhgates"] })) as {
          isError?: boolean;
          content: { type: string; text: string }[];
        };

        expect(result.isError, `MCP tool error: ${result.content?.[0]?.text}`).toBeUndefined();
        expect(result.content).toHaveLength(1);

        const parsed = JSON.parse((result.content[0] as { text: string }).text) as {
          byPublicId: ({ id: number; miniProfile: { firstName: string } } | null)[];
        };

        expect(parsed.byPublicId).toHaveLength(1);
        expect(parsed.byPublicId[0]).not.toBeNull();
      });

      it("looks up profiles by personIds", async () => {
        // Step 1: get a profile by publicId to extract the numeric id
        const { server: server1, getHandler: getHandler1 } = createMockServer();
        registerQueryProfilesBulk(server1);

        const handler1 = getHandler1("query-profiles-bulk");
        const result1 = (await handler1({ publicIds: ["williamhgates"] })) as {
          content: { type: string; text: string }[];
        };
        const profiles1 = JSON.parse((result1.content[0] as { text: string }).text) as {
          byPublicId: ({ id: number } | null)[];
        };
        const numericId = (profiles1.byPublicId[0] as { id: number }).id;

        // Step 2: query the same profile by its numeric personId
        const { server: server2, getHandler: getHandler2 } = createMockServer();
        registerQueryProfilesBulk(server2);

        const handler2 = getHandler2("query-profiles-bulk");
        const result2 = (await handler2({ personIds: [numericId] })) as {
          isError?: boolean;
          content: { type: string; text: string }[];
        };

        expect(result2.isError).toBeUndefined();
        expect(result2.content).toHaveLength(1);

        const parsed = JSON.parse((result2.content[0] as { text: string }).text) as {
          byPersonId: ({ id: number } | null)[];
        };

        expect(parsed.byPersonId).toHaveLength(1);
        expect(parsed.byPersonId[0]).not.toBeNull();
        expect((parsed.byPersonId[0] as { id: number }).id).toBe(numericId);
      });
    });
  });

  // ── Instance-requiring tools ──────────────────────────────────────

  describe("instance-requiring tools", () => {
    let app: AppService;
    let port: number;
    let accountId: number;
    let personId: number;

    beforeAll(async () => {
      personId = getE2EPersonId();

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

    installErrorDetection(() => port);

    // ── enrich-profile ──────────────────────────────────────────────

    describe("enrich-profile", () => {
      describe("CLI handler", () => {
        const originalExitCode = process.exitCode;

        beforeEach(() => {
          process.exitCode = undefined;
        });

        afterEach(() => {
          process.exitCode = originalExitCode;
          vi.restoreAllMocks();
        });

        it("enriches a profile by personId --json", async () => {
          const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

          await handleEnrichProfile({
            personId,
            enrichProfileInfo: true,
            cdpPort: port,
            json: true,
          });

          expect(process.exitCode).toBeUndefined();
          expect(stdoutSpy).toHaveBeenCalled();

          const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
          const parsed = JSON.parse(output) as {
            success: boolean;
            personId: number;
          };

          expect(parsed.success).toBe(true);
          expect(parsed.personId).toBe(personId);
        }, 180_000);
      });

      describe("MCP tool", () => {
        it("enriches a profile by personId", async () => {
          const { server, getHandler } = createMockServer();
          registerEnrichProfile(server);

          const handler = getHandler("enrich-profile");
          const result = (await handler({
            personId,
            profileInfo: { shouldEnrich: true },
            cdpPort: port,
          })) as {
            isError?: boolean;
            content: { type: string; text: string }[];
          };

          expect(result.isError, `MCP tool error: ${result.content?.[0]?.text}`).toBeUndefined();
          expect(result.content).toHaveLength(1);

          const parsed = JSON.parse((result.content[0] as { text: string }).text) as {
            success: boolean;
            personId: number;
          };

          expect(parsed.success).toBe(true);
          expect(parsed.personId).toBe(personId);
        }, 180_000);
      });
    });

    // ── resolve-linkedin-entity ─────────────────────────────────────

    describe("resolve-linkedin-entity", () => {
      describe("CLI handler", () => {
        const originalExitCode = process.exitCode;

        beforeEach(() => {
          process.exitCode = undefined;
        });

        afterEach(() => {
          process.exitCode = originalExitCode;
          vi.restoreAllMocks();
        });

        it("resolves a COMPANY entity --json", async () => {
          const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

          await handleResolveEntity("COMPANY", "Google", {
            cdpPort: port,
            json: true,
          });

          expect(process.exitCode).toBeUndefined();
          expect(stdoutSpy).toHaveBeenCalled();

          const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
          const parsed = JSON.parse(output) as {
            matches: { id: string; name: string; type: string }[];
            strategy: string;
          };

          expect(Array.isArray(parsed.matches)).toBe(true);
          expect(["public", "voyager"]).toContain(parsed.strategy);
          if (parsed.matches.length > 0) {
            expect(parsed.matches[0]).toHaveProperty("id");
            expect(parsed.matches[0]).toHaveProperty("name");
          } else {
            // LinkedIn typeahead may return zero results depending on account
            // state or API availability — log so it's not silently ignored
            console.warn("resolve-entity CLI: LinkedIn returned 0 matches for 'Google' (COMPANY)");
          }
        }, 30_000);
      });

      describe("MCP tool", () => {
        it("resolves a COMPANY entity", async () => {
          const { server, getHandler } = createMockServer();
          registerResolveLinkedInEntity(server);

          const handler = getHandler("resolve-linkedin-entity");
          const result = (await handler({
            query: "Google",
            entityType: "COMPANY",
            cdpPort: port,
          })) as {
            isError?: boolean;
            content: { type: string; text: string }[];
          };

          expect(result.isError, `MCP tool error: ${result.content?.[0]?.text}`).toBeUndefined();
          expect(result.content).toHaveLength(1);

          const parsed = JSON.parse((result.content[0] as { text: string }).text) as {
            matches: { id: string; name: string; type: string }[];
            strategy: string;
          };

          expect(Array.isArray(parsed.matches)).toBe(true);
          expect(["public", "voyager"]).toContain(parsed.strategy);
          if (parsed.matches.length > 0) {
            expect(parsed.matches[0]).toHaveProperty("id");
            expect(parsed.matches[0]).toHaveProperty("name");
          } else {
            // LinkedIn typeahead may return zero results depending on account
            // state or API availability — log so it's not silently ignored
            console.warn("resolve-entity MCP: LinkedIn returned 0 matches for 'Google' (COMPANY)");
          }
        }, 30_000);
      });
    });

    // ── get-action-budget ───────────────────────────────────────────

    describe("get-action-budget", () => {
      describe("CLI handler", () => {
        const originalExitCode = process.exitCode;

        beforeEach(() => {
          process.exitCode = undefined;
        });

        afterEach(() => {
          process.exitCode = originalExitCode;
          vi.restoreAllMocks();
        });

        it("returns daily limits and remaining budget --json", async () => {
          const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

          await handleGetActionBudget({ cdpPort: port, json: true });

          expect(process.exitCode).toBeUndefined();
          expect(stdoutSpy).toHaveBeenCalled();

          const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
          const parsed = JSON.parse(output) as {
            entries: {
              limitTypeId: number;
              limitType: string;
              dailyLimit: number | null;
              campaignUsed: number;
              directUsed: number;
              totalUsed: number;
              remaining: number | null;
            }[];
            asOf: string;
          };

          expect(Array.isArray(parsed.entries)).toBe(true);
          expect(parsed.entries.length).toBeGreaterThan(0);
          expect(typeof parsed.asOf).toBe("string");

          const entry = parsed.entries[0];
          expect(entry).toBeDefined();
          expect(typeof entry?.limitTypeId).toBe("number");
          expect(typeof entry?.limitType).toBe("string");
        }, 30_000);
      });

      describe("MCP tool", () => {
        it("returns action budget", async () => {
          const { server, getHandler } = createMockServer();
          registerGetActionBudget(server);

          const handler = getHandler("get-action-budget");
          const result = (await handler({ cdpPort: port })) as {
            isError?: boolean;
            content: { type: string; text: string }[];
          };

          expect(result.isError, `MCP tool error: ${result.content?.[0]?.text}`).toBeUndefined();
          expect(result.content).toHaveLength(1);

          const parsed = JSON.parse((result.content[0] as { text: string }).text) as {
            entries: { limitTypeId: number; limitType: string }[];
            asOf: string;
          };

          expect(parsed.entries.length).toBeGreaterThan(0);
          expect(typeof parsed.asOf).toBe("string");
        }, 30_000);
      });
    });

    // ── get-throttle-status ─────────────────────────────────────────

    describe("get-throttle-status", () => {
      describe("CLI handler", () => {
        const originalExitCode = process.exitCode;

        beforeEach(() => {
          process.exitCode = undefined;
        });

        afterEach(() => {
          process.exitCode = originalExitCode;
          vi.restoreAllMocks();
        });

        it("returns throttle state --json", async () => {
          const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

          await handleGetThrottleStatus({ cdpPort: port, json: true });

          expect(process.exitCode).toBeUndefined();
          expect(stdoutSpy).toHaveBeenCalled();

          const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
          const parsed = JSON.parse(output) as {
            throttled: boolean;
            since: string | null;
          };

          expect(typeof parsed.throttled).toBe("boolean");
          if (parsed.throttled) {
            expect(typeof parsed.since).toBe("string");
          } else {
            expect(parsed.since).toBeNull();
          }
        }, 30_000);
      });

      describe("MCP tool", () => {
        it("returns throttle state", async () => {
          const { server, getHandler } = createMockServer();
          registerGetThrottleStatus(server);

          const handler = getHandler("get-throttle-status");
          const result = (await handler({ cdpPort: port })) as {
            isError?: boolean;
            content: { type: string; text: string }[];
          };

          expect(result.isError, `MCP tool error: ${result.content?.[0]?.text}`).toBeUndefined();
          expect(result.content).toHaveLength(1);

          const parsed = JSON.parse((result.content[0] as { text: string }).text) as {
            throttled: boolean;
            since: string | null;
          };

          expect(typeof parsed.throttled).toBe("boolean");
        }, 30_000);
      });
    });
  });
});
