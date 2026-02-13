// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { describeE2E, launchApp, quitApp, retryAsync } from "@lhremote/core/testing";
import {
  AppService,
  CampaignRepository,
  DatabaseClient,
  checkStatus,
  discoverDatabase,
  discoverTargets,
  findApp,
  killInstanceProcesses,
  LauncherService,
  startInstanceWithRecovery,
  waitForInstanceShutdown,
} from "@lhremote/core";
import type {
  Account,
  CampaignSummary,
  DiscoveredApp,
  Profile,
  StatusReport,
} from "@lhremote/core";

// CLI handlers — tested against the same running app
import {
  handleCheckReplies,
  handleCheckStatus,
  handleFindApp,
  handleListAccounts,
  handleQueryProfile,
  handleQuitApp,
  handleScrapeMessagingHistory,
  handleStartInstance,
  handleStopInstance,
} from "@lhremote/cli/handlers";

// MCP tool registration — tested against the same running app
import {
  registerCheckReplies,
  registerCheckStatus,
  registerFindApp,
  registerQueryProfile,
  registerScrapeMessagingHistory,
  registerStartInstance,
  registerStopInstance,
} from "@lhremote/mcp/tools";
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

describeE2E("App lifecycle", () => {
  let app: AppService;
  let port: number;

  beforeAll(async () => {
    const launched = await launchApp();
    app = launched.app;
    port = launched.port;
  }, 60_000);

  afterAll(async () => {
    await quitApp(app);
  }, 30_000);

  describe("AppService", () => {
    it("reports isRunning() as true after launch", async () => {
      expect(await app.isRunning()).toBe(true);
    });

    it("exposes the assigned CDP port", () => {
      expect(port).toBeGreaterThan(0);
      expect(app.cdpPort).toBe(port);
    });

    it("launch() is idempotent when already running", async () => {
      await app.launch();
      expect(await app.isRunning()).toBe(true);
    });

    it("discovers CDP targets", async () => {
      const targets = await retryAsync(async () => {
        const t = await discoverTargets(port);
        if (t.length === 0) throw new Error("No CDP targets yet");
        return t;
      });
      expect(targets.length).toBeGreaterThan(0);
      for (const t of targets) {
        console.log(`  target: type=${t.type} title=${t.title} url=${t.url}`);
      }
    });
  });

  describe("findApp", () => {
    it("discovers the running LinkedHelper process", async () => {
      const apps = await findApp();

      expect(apps.length).toBeGreaterThan(0);

      const connectable = apps.filter((a) => a.connectable);
      expect(connectable.length).toBeGreaterThan(0);

      for (const app of connectable) {
        expect(app.pid).toBeGreaterThan(0);
        expect(app.cdpPort).toBeGreaterThan(0);
      }
    });

    it("finds a process whose CDP port matches the launched port", async () => {
      const apps = await findApp();

      const match = apps.find((a) => a.cdpPort === port);
      assertDefined(match, `Expected findApp to discover port ${String(port)}`);
      expect(match.connectable).toBe(true);
    });
  });

  describe("LauncherService", () => {
    let launcher: LauncherService;

    beforeAll(async () => {
      launcher = new LauncherService(port);
      await retryAsync(() => launcher.connect(), { retries: 3, delay: 1_000 });
    }, 15_000);

    afterAll(() => {
      launcher.disconnect();
    });

    it("connects successfully", () => {
      expect(launcher.isConnected).toBe(true);
    });

    it("listAccounts() returns an array", async () => {
      const accounts = await launcher.listAccounts();
      expect(Array.isArray(accounts)).toBe(true);
    });

    it("listAccounts() returns accounts with expected shape", async () => {
      const accounts = await launcher.listAccounts();
      for (const account of accounts) {
        expect(account).toHaveProperty("id");
        expect(account).toHaveProperty("name");
      }
    });

    it("disconnect() succeeds cleanly", () => {
      launcher.disconnect();
      expect(launcher.isConnected).toBe(false);
    });
  });

  describe("checkStatus", () => {
    it("reports launcher as reachable", async () => {
      const report = await retryAsync(async () => {
        const r = await checkStatus(port);
        if (!r.launcher.reachable) throw new Error("Launcher not reachable yet");
        return r;
      });

      expect(report.launcher.reachable).toBe(true);
      expect(report.launcher.port).toBe(port);
    });

    it("reports accounts", async () => {
      const report = await checkStatus(port);

      // Accounts may or may not exist — just verify structure
      for (const instance of report.instances) {
        expect(instance).toHaveProperty("accountId");
        expect(instance).toHaveProperty("accountName");
        expect(instance).toHaveProperty("cdpPort");
      }
    });

    it("reports databases", async () => {
      const report = await checkStatus(port);

      for (const db of report.databases) {
        expect(db).toHaveProperty("accountId");
        expect(db).toHaveProperty("path");
        expect(db).toHaveProperty("profileCount");
        expect(db.profileCount).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("CampaignRepository", () => {
    let launcher: LauncherService;
    let accountId: number | undefined;
    let dbClient: DatabaseClient | null = null;
    let repo: CampaignRepository | null = null;

    beforeAll(async () => {
      launcher = new LauncherService(port);
      await retryAsync(() => launcher.connect(), { retries: 3, delay: 1_000 });

      const accounts = await launcher.listAccounts();
      launcher.disconnect();

      if (accounts.length > 0) {
        accountId = (accounts[0] as Account).id;
        const dbPath = discoverDatabase(accountId);
        dbClient = new DatabaseClient(dbPath);
        repo = new CampaignRepository(dbClient);
      }
    }, 15_000);

    afterAll(() => {
      dbClient?.close();
    });

    it("listCampaigns() returns campaigns with expected shape", () => {
      assertDefined(repo, "No accounts configured in LinkedHelper");

      const campaigns = repo.listCampaigns({ includeArchived: true });

      // Real database should have at least one campaign
      expect(campaigns.length).toBeGreaterThan(0);

      for (const campaign of campaigns) {
        expect(campaign).toHaveProperty("id");
        expect(campaign).toHaveProperty("name");
        expect(typeof campaign.name).toBe("string");
        expect(campaign).toHaveProperty("state");
        expect(["active", "paused", "archived", "invalid"]).toContain(campaign.state);
        expect(campaign).toHaveProperty("liAccountId");
        expect(typeof campaign.actionCount).toBe("number");
        expect(campaign.actionCount).toBeGreaterThanOrEqual(0);
        expect(campaign).toHaveProperty("createdAt");
      }
    });

    it("getCampaign() returns full campaign details", () => {
      assertDefined(repo, "No accounts configured in LinkedHelper");

      const campaigns = repo.listCampaigns({ includeArchived: true });
      expect(campaigns.length, "No campaigns found in database").toBeGreaterThan(0);

      const campaign = repo.getCampaign((campaigns[0] as CampaignSummary).id);

      expect(campaign).toHaveProperty("id");
      expect(campaign).toHaveProperty("name");
      expect(campaign).toHaveProperty("state");
      expect(typeof campaign.isPaused).toBe("boolean");
      expect(typeof campaign.isArchived).toBe("boolean");
      expect(campaign.isValid === null || typeof campaign.isValid === "boolean").toBe(true);
      expect(campaign).toHaveProperty("createdAt");
    });

    it("getCampaignActions() returns actions with parsed config", () => {
      assertDefined(repo, "No accounts configured in LinkedHelper");

      // Find a campaign that has actions
      const campaigns = repo.listCampaigns({ includeArchived: true });
      const withActions = campaigns.find((c) => c.actionCount > 0);

      if (!withActions) {
        console.log("  skipping: no campaigns with actions found");
        return;
      }

      const actions = repo.getCampaignActions(withActions.id);

      expect(actions.length).toBeGreaterThan(0);
      for (const action of actions) {
        expect(action).toHaveProperty("id");
        expect(action).toHaveProperty("campaignId");
        expect(action.campaignId).toBe(withActions.id);
        expect(action).toHaveProperty("name");
        expect(typeof action.name).toBe("string");
        expect(action).toHaveProperty("config");
        expect(action.config).toHaveProperty("actionType");
        expect(typeof action.config.actionType).toBe("string");
        expect(action.config).toHaveProperty("actionSettings");
        expect(typeof action.config.actionSettings).toBe("object");
        expect(action).toHaveProperty("versionId");
      }
    });

    it("getResults() returns results with expected shape", () => {
      assertDefined(repo, "No accounts configured in LinkedHelper");

      // Find a campaign that has actions (likely has results too)
      const campaigns = repo.listCampaigns({ includeArchived: true });
      const withActions = campaigns.find((c) => c.actionCount > 0);

      if (!withActions) {
        console.log("  skipping: no campaigns with actions found");
        return;
      }

      const results = repo.getResults(withActions.id, { limit: 10 });

      // Results may be empty if campaign hasn't run — just verify shape
      for (const result of results) {
        expect(result).toHaveProperty("id");
        expect(result).toHaveProperty("actionVersionId");
        expect(result).toHaveProperty("personId");
        expect(typeof result.result).toBe("number");
        expect(result).toHaveProperty("createdAt");
      }
    });
  });

  describe("startInstanceWithRecovery", () => {
    let launcher: LauncherService;
    let accountId: number | undefined;

    beforeAll(async () => {
      launcher = new LauncherService(port);
      await launcher.connect();

      const accounts = await launcher.listAccounts();
      if (accounts.length > 0) {
        accountId = (accounts[0] as Account).id;
      }
    }, 15_000);

    afterAll(async () => {
      await forceStopInstance(launcher, accountId, port);
      launcher.disconnect();
    }, 30_000);

    it("starts an instance and returns port", async () => {
      assertDefined(accountId, "No accounts configured in LinkedHelper");

      const result = await startInstanceWithRecovery(
        launcher,
        accountId,
        port,
      );

      expect(result.status).toMatch(/^(started|already_running)$/);
      expect(result).toHaveProperty("port");
      expect((result as { port: number }).port).toBeGreaterThan(0);
    }, 60_000);

    it("is idempotent — second call returns already_running", async () => {
      assertDefined(accountId, "No accounts configured in LinkedHelper");

      const result = await startInstanceWithRecovery(
        launcher,
        accountId,
        port,
      );

      expect(result.status).toBe("already_running");
      expect(result).toHaveProperty("port");
      expect((result as { port: number }).port).toBeGreaterThan(0);
    }, 60_000);

    it("instance can be stopped after start", async () => {
      assertDefined(accountId, "No accounts configured in LinkedHelper");

      await launcher.stopInstance(accountId);

      // Stopping again should not throw (idempotent)
      await launcher.stopInstance(accountId);
    }, 30_000);
  });

  describe("CLI handlers", () => {
    const originalExitCode = process.exitCode;

    afterAll(async () => {
      // Force-stop any instance left running by tests in this block
      const launcher = new LauncherService(port);
      try {
        await launcher.connect();
        const accounts = await launcher.listAccounts();
        if (accounts.length > 0) {
          await forceStopInstance(launcher, (accounts[0] as Account).id, port);
        }
      } catch {
        // Best-effort cleanup
      } finally {
        launcher.disconnect();
      }
    }, 30_000);

    beforeEach(() => {
      process.exitCode = undefined;
    });

    afterEach(() => {
      process.exitCode = originalExitCode;
      vi.restoreAllMocks();
    });

    it("handleListAccounts --json writes valid JSON to stdout", async () => {
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleListAccounts({ cdpPort: port, json: true });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      const parsed = JSON.parse(output) as unknown;
      expect(Array.isArray(parsed)).toBe(true);
    });

    it("handleListAccounts prints formatted output", async () => {
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleListAccounts({ cdpPort: port });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();
    });

    it("handleCheckStatus --json writes valid JSON to stdout", async () => {
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleCheckStatus({ cdpPort: port, json: true });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      const parsed = JSON.parse(output) as StatusReport;
      expect(parsed.launcher.reachable).toBe(true);
    });

    it("handleFindApp --json writes valid JSON to stdout", async () => {
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleFindApp({ json: true });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      const parsed = JSON.parse(output) as DiscoveredApp[];
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThan(0);

      const match = parsed.find((a) => a.cdpPort === port);
      assertDefined(match, `Expected findApp to discover port ${String(port)}`);
      expect(match.connectable).toBe(true);
    });

    it("handleFindApp prints human-friendly output", async () => {
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleFindApp({});

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      expect(output).toMatch(/PID \d+/);
      expect(output).toContain("connectable");
    });

    it("handleCheckStatus prints human-friendly output", async () => {
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleCheckStatus({ cdpPort: port });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      expect(output).toContain("Launcher: reachable");
    });

    it(
      "handleStartInstance starts instance and reports CDP port",
      async () => {
        const launcher = new LauncherService(port);
        await launcher.connect();
        const accounts = await launcher.listAccounts();
        launcher.disconnect();

        expect(accounts.length, "No accounts configured in LinkedHelper").toBeGreaterThan(0);
        const accountId = (accounts[0] as Account).id;

        const stdoutSpy = vi
          .spyOn(process.stdout, "write")
          .mockReturnValue(true);

        await handleStartInstance(String(accountId), { cdpPort: port });

        expect(process.exitCode).toBeUndefined();
        expect(stdoutSpy).toHaveBeenCalled();

        const output = stdoutSpy.mock.calls
          .map((call) => String(call[0]))
          .join("");
        expect(output).toMatch(/Instance (started|already running) for account/);
        expect(output).toMatch(/on CDP port \d+/);
      },
      60_000,
    );

    it("handleQueryProfile --json returns cached profile by publicId", async () => {
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleQueryProfile({ publicId: "williamhgates", json: true });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      const parsed = JSON.parse(output) as Profile;
      expect(parsed.miniProfile).toHaveProperty("firstName");
      expect(typeof parsed.miniProfile.firstName).toBe("string");
      expect(parsed.miniProfile.firstName.length).toBeGreaterThan(0);
      expect(Array.isArray(parsed.positions)).toBe(true);
      expect(Array.isArray(parsed.skills)).toBe(true);
    });

    it("handleQueryProfile prints human-friendly output", async () => {
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleQueryProfile({ publicId: "williamhgates" });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      // Should contain a name with ID
      expect(output).toMatch(/#\d+/);
    });

    it(
      "handleScrapeMessagingHistory --json scrapes and returns stats",
      async () => {
        const stdoutSpy = vi
          .spyOn(process.stdout, "write")
          .mockReturnValue(true);
        const stderrSpy = vi
          .spyOn(process.stderr, "write")
          .mockReturnValue(true);

        await handleScrapeMessagingHistory({ cdpPort: port, json: true });

        if (process.exitCode === 1) {
          const errOutput = stderrSpy.mock.calls
            .map((call) => String(call[0]))
            .join("");
          throw new Error(`handleScrapeMessagingHistory failed: ${errOutput}`);
        }

        expect(process.exitCode).toBeUndefined();
        expect(stdoutSpy).toHaveBeenCalled();

        const output = stdoutSpy.mock.calls
          .map((call) => String(call[0]))
          .join("");
        const parsed = JSON.parse(output) as {
          success: boolean;
          actionType: string;
          stats: { totalChats: number; totalMessages: number };
        };
        expect(parsed.success).toBe(true);
        expect(parsed.actionType).toBe("ScrapeMessagingHistory");
        expect(typeof parsed.stats.totalChats).toBe("number");
        expect(typeof parsed.stats.totalMessages).toBe("number");
      },
      300_000,
    );

    it(
      "handleScrapeMessagingHistory prints human-friendly output",
      async () => {
        const stdoutSpy = vi
          .spyOn(process.stdout, "write")
          .mockReturnValue(true);
        vi.spyOn(process.stderr, "write").mockReturnValue(true);

        await handleScrapeMessagingHistory({ cdpPort: port });

        expect(process.exitCode).toBeUndefined();
        expect(stdoutSpy).toHaveBeenCalled();

        const output = stdoutSpy.mock.calls
          .map((call) => String(call[0]))
          .join("");
        expect(output).toMatch(/conversations/);
        expect(output).toMatch(/messages/);
      },
      300_000,
    );

    it(
      "handleCheckReplies --json checks for replies and returns JSON",
      async () => {
        const stdoutSpy = vi
          .spyOn(process.stdout, "write")
          .mockReturnValue(true);
        const stderrSpy = vi
          .spyOn(process.stderr, "write")
          .mockReturnValue(true);

        await handleCheckReplies({ cdpPort: port, json: true });

        if (process.exitCode === 1) {
          const errOutput = stderrSpy.mock.calls
            .map((call: unknown[]) => String(call[0]))
            .join("");
          throw new Error(`handleCheckReplies failed: ${errOutput}`);
        }

        expect(process.exitCode).toBeUndefined();
        expect(stdoutSpy).toHaveBeenCalled();

        const output = stdoutSpy.mock.calls
          .map((call: unknown[]) => String(call[0]))
          .join("");
        const parsed = JSON.parse(output) as {
          newMessages: unknown[];
          totalNew: number;
          checkedAt: string;
        };
        expect(Array.isArray(parsed.newMessages)).toBe(true);
        expect(typeof parsed.totalNew).toBe("number");
        expect(parsed.checkedAt).toBeTruthy();
      },
      180_000,
    );

    it(
      "handleCheckReplies prints human-friendly output",
      async () => {
        const stdoutSpy = vi
          .spyOn(process.stdout, "write")
          .mockReturnValue(true);
        vi.spyOn(process.stderr, "write").mockReturnValue(true);

        await handleCheckReplies({ cdpPort: port });

        expect(process.exitCode).toBeUndefined();
        expect(stdoutSpy).toHaveBeenCalled();

        const output = stdoutSpy.mock.calls
          .map((call: unknown[]) => String(call[0]))
          .join("");
        // Should contain either "No new messages" or "new message(s) found"
        expect(output).toMatch(/new message|No new messages/);
      },
      180_000,
    );

    it(
      "handleStopInstance stops running instance",
      async () => {
        const launcher = new LauncherService(port);
        await launcher.connect();
        const accounts = await launcher.listAccounts();
        launcher.disconnect();

        expect(accounts.length, "No accounts configured in LinkedHelper").toBeGreaterThan(0);
        const accountId = (accounts[0] as Account).id;

        const stdoutSpy = vi
          .spyOn(process.stdout, "write")
          .mockReturnValue(true);

        await handleStopInstance(String(accountId), { cdpPort: port });

        expect(process.exitCode).toBeUndefined();
        expect(stdoutSpy).toHaveBeenCalledWith(
          `Instance stopped for account ${String(accountId)}\n`,
        );
      },
      30_000,
    );
  });

  describe("MCP tools", () => {
    let accountId: number | undefined;

    beforeAll(async () => {
      const launcher = new LauncherService(port);
      await launcher.connect();
      const accounts = await launcher.listAccounts();
      launcher.disconnect();

      if (accounts.length > 0) {
        accountId = (accounts[0] as Account).id;
      }
    }, 15_000);

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
    }, 30_000);

    it("find-app tool discovers running instances", async () => {
      const { server, getHandler } = createMockServer();
      registerFindApp(server);

      const handler = getHandler("find-app");
      const result = (await handler({})) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(
        (result.content[0] as { text: string }).text,
      ) as DiscoveredApp[];
      expect(parsed.length).toBeGreaterThan(0);

      const match = parsed.find((a) => a.cdpPort === port);
      assertDefined(match, `Expected findApp to discover port ${String(port)}`);
      expect(match.connectable).toBe(true);
    });

    it("check-status tool returns status report", async () => {
      const { server, getHandler } = createMockServer();
      registerCheckStatus(server);

      const handler = getHandler("check-status");
      const result = (await handler({ cdpPort: port })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(
        (result.content[0] as { text: string }).text,
      ) as StatusReport;
      expect(parsed.launcher.reachable).toBe(true);
      expect(parsed.launcher.port).toBe(port);
    });

    it(
      "start-instance tool starts instance and returns CDP port",
      async () => {
        assertDefined(accountId, "No accounts configured in LinkedHelper");

        const { server, getHandler } = createMockServer();
        registerStartInstance(server);

        const handler = getHandler("start-instance");
        const result = (await handler({ accountId, cdpPort: port })) as {
          isError?: boolean;
          content: { type: string; text: string }[];
        };

        expect(result.isError).toBeUndefined();
        expect(result.content).toHaveLength(1);

        const text = (result.content[0] as { text: string }).text;
        expect(text).toMatch(
          /Instance (started|already running) for account .+ on CDP port \d+/,
        );
      },
      60_000,
    );

    it("query-profile tool returns cached profile by publicId", async () => {
      const { server, getHandler } = createMockServer();
      registerQueryProfile(server);

      const handler = getHandler("query-profile");
      const result = (await handler({ publicId: "williamhgates" })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(
        (result.content[0] as { text: string }).text,
      ) as Profile;
      expect(parsed.miniProfile).toHaveProperty("firstName");
      expect(typeof parsed.miniProfile.firstName).toBe("string");
      expect(parsed.miniProfile.firstName.length).toBeGreaterThan(0);
      expect(Array.isArray(parsed.positions)).toBe(true);
      expect(Array.isArray(parsed.skills)).toBe(true);
    });

    it("query-profile tool returns cached profile by personId", async () => {
      // First get the profile by publicId to find the personId
      const { server: server1, getHandler: getHandler1 } = createMockServer();
      registerQueryProfile(server1);

      const handler1 = getHandler1("query-profile");
      const result1 = (await handler1({ publicId: "williamhgates" })) as {
        content: { type: string; text: string }[];
      };
      const profile1 = JSON.parse(
        (result1.content[0] as { text: string }).text,
      ) as Profile;

      // Now look up by personId
      const { server: server2, getHandler: getHandler2 } = createMockServer();
      registerQueryProfile(server2);

      const handler2 = getHandler2("query-profile");
      const result2 = (await handler2({ personId: profile1.id })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(result2.isError).toBeUndefined();
      expect(result2.content).toHaveLength(1);

      const parsed = JSON.parse(
        (result2.content[0] as { text: string }).text,
      ) as Profile;
      expect(parsed.id).toBe(profile1.id);
      expect(parsed.miniProfile.firstName).toBe(profile1.miniProfile.firstName);
    });

    it(
      "scrape-messaging-history tool scrapes and returns stats",
      async () => {
        assertDefined(accountId, "No accounts configured in LinkedHelper");

        const { server, getHandler } = createMockServer();
        registerScrapeMessagingHistory(server);

        const handler = getHandler("scrape-messaging-history");
        const result = (await handler({ cdpPort: port })) as {
          isError?: boolean;
          content: { type: string; text: string }[];
        };

        expect(result.isError).toBeUndefined();
        expect(result.content).toHaveLength(1);

        const parsed = JSON.parse(
          (result.content[0] as { text: string }).text,
        ) as {
          success: boolean;
          actionType: string;
          stats: { totalChats: number; totalMessages: number };
        };
        expect(parsed.success).toBe(true);
        expect(parsed.actionType).toBe("ScrapeMessagingHistory");
        expect(typeof parsed.stats.totalChats).toBe("number");
        expect(typeof parsed.stats.totalMessages).toBe("number");
      },
      300_000,
    );

    it(
      "check-replies tool checks for replies and returns results",
      async () => {
        assertDefined(accountId, "No accounts configured in LinkedHelper");

        const { server, getHandler } = createMockServer();
        registerCheckReplies(server);

        const handler = getHandler("check-replies");
        const result = (await handler({ cdpPort: port })) as {
          isError?: boolean;
          content: { type: string; text: string }[];
        };

        expect(result.isError).toBeUndefined();
        expect(result.content).toHaveLength(1);

        const parsed = JSON.parse(
          (result.content[0] as { text: string }).text,
        ) as {
          newMessages: unknown[];
          totalNew: number;
          checkedAt: string;
        };
        expect(Array.isArray(parsed.newMessages)).toBe(true);
        expect(typeof parsed.totalNew).toBe("number");
        expect(parsed.checkedAt).toBeTruthy();
      },
      180_000,
    );

    it(
      "stop-instance tool stops running instance",
      async () => {
        assertDefined(accountId, "No accounts configured in LinkedHelper");

        const { server, getHandler } = createMockServer();
        registerStopInstance(server);

        const handler = getHandler("stop-instance");
        const result = (await handler({ accountId, cdpPort: port })) as {
          isError?: boolean;
          content: { type: string; text: string }[];
        };

        expect(result.isError).toBeUndefined();
        expect(result.content).toHaveLength(1);

        const text = (result.content[0] as { text: string }).text;
        expect(text).toBe(
          `Instance stopped for account ${String(accountId)}`,
        );
      },
      30_000,
    );
  });

  describe("AppService shutdown", () => {
    it(
      "quit() stops the application",
      async () => {
        await app.quit();

        // quit() now waits for the process to exit (SIGTERM → SIGKILL),
        // but the CDP endpoint may linger briefly. Poll to confirm.
        const deadline = Date.now() + 5_000;
        const probe = new AppService(port);
        while (Date.now() < deadline) {
          if (!(await probe.isRunning())) {
            break;
          }
          await new Promise<void>((r) => setTimeout(r, 250));
        }

        expect(await probe.isRunning()).toBe(false);

        // Prevent top-level afterAll from trying to quit again
        app = new AppService();
      },
      30_000,
    );

    it("quit() is a no-op when not running", async () => {
      const fresh = new AppService();
      await fresh.quit();
    });
  });

  describe("CLI quit handler", () => {
    const originalExitCode = process.exitCode;

    beforeEach(() => {
      process.exitCode = undefined;
    });

    afterEach(() => {
      process.exitCode = originalExitCode;
      vi.restoreAllMocks();
    });

    it("handleQuitApp writes success message to stdout", async () => {
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleQuitApp({ cdpPort: port });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalledWith("LinkedHelper quit\n");

      // Prevent afterAll from trying to quit the already-quit app
      app = new AppService();
    }, 15_000);
  });
});
