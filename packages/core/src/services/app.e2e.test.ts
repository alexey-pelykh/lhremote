import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { describeE2E, launchApp, quitApp } from "../testing/e2e-helpers.js";
import { discoverTargets } from "../cdp/discovery.js";
import type { Account } from "../types/index.js";
import { AppService } from "./app.js";
import { startInstanceWithRecovery } from "./instance-lifecycle.js";
import { LauncherService } from "./launcher.js";

// CLI handlers — tested against the same running app
import { handleListAccounts } from "../../../cli/src/handlers/list-accounts.js";
import { handleQuitApp } from "../../../cli/src/handlers/quit-app.js";
import { handleStartInstance } from "../../../cli/src/handlers/start-instance.js";
import { handleStopInstance } from "../../../cli/src/handlers/stop-instance.js";

// MCP tool registration — tested against the same running app
import { registerStartInstance } from "../../../mcp/src/tools/start-instance.js";
import { registerStopInstance } from "../../../mcp/src/tools/stop-instance.js";
import { createMockServer } from "../../../mcp/src/tools/testing/mock-server.js";

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
      const targets = await discoverTargets(port);
      expect(targets.length).toBeGreaterThan(0);
      for (const t of targets) {
        console.log(`  target: type=${t.type} title=${t.title} url=${t.url}`);
      }
    });
  });

  describe("LauncherService", () => {
    let launcher: LauncherService;

    beforeAll(async () => {
      launcher = new LauncherService(port);
      await launcher.connect();
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
      if (accountId !== undefined) {
        try {
          await launcher.stopInstance(accountId);
        } catch {
          // Ignore — may not be running
        }
      }
      launcher.disconnect();
    }, 30_000);

    it("starts an instance and returns port", async () => {
      if (accountId === undefined) {
        return; // No accounts configured — skip
      }

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
      if (accountId === undefined) {
        return; // No accounts configured — skip
      }

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
      if (accountId === undefined) {
        return; // No accounts configured — skip
      }

      await launcher.stopInstance(accountId);

      // Stopping again should not throw (idempotent)
      await launcher.stopInstance(accountId);
    }, 30_000);
  });

  describe("CLI handlers", () => {
    const originalExitCode = process.exitCode;

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

    it(
      "handleStartInstance starts instance and reports CDP port",
      async () => {
        const launcher = new LauncherService(port);
        await launcher.connect();
        const accounts = await launcher.listAccounts();
        launcher.disconnect();

        if (accounts.length === 0) {
          return; // No accounts configured — skip
        }
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

    it(
      "handleStopInstance stops running instance",
      async () => {
        const launcher = new LauncherService(port);
        await launcher.connect();
        const accounts = await launcher.listAccounts();
        launcher.disconnect();

        if (accounts.length === 0) {
          return; // No accounts configured — skip
        }
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
      if (accountId !== undefined) {
        const launcher = new LauncherService(port);
        try {
          await launcher.connect();
          await launcher.stopInstance(accountId);
          launcher.disconnect();
        } catch {
          // Ignore cleanup errors
        }
      }
    }, 30_000);

    it(
      "start-instance tool starts instance and returns CDP port",
      async () => {
        if (accountId === undefined) {
          return; // No accounts configured — skip
        }

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

    it(
      "stop-instance tool stops running instance",
      async () => {
        if (accountId === undefined) {
          return; // No accounts configured — skip
        }

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
