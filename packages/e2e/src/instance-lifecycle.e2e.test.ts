// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertDefined,
  describeE2E,
  forceStopInstance,
  launchApp,
  quitApp,
  resolveAccountId,
} from "@lhremote/core/testing";
import {
  AppService,
  discoverInstancePort,
  findApp,
  LauncherService,
  startInstanceWithRecovery,
  WrongPortError,
} from "@lhremote/core";
import { handleStartInstance, handleStopInstance } from "@lhremote/cli/handlers";
import { registerStartInstance, registerStopInstance } from "@lhremote/mcp/tools";
import { createMockServer } from "@lhremote/mcp/testing";

describeE2E("Instance lifecycle", () => {
  let app: AppService;
  let port: number;
  let accountId: number;

  beforeAll(async () => {
    const launched = await launchApp();
    app = launched.app;
    port = launched.port;
    accountId = await resolveAccountId(port);
  }, 60_000);

  afterAll(async () => {
    await quitApp(app);
  }, 30_000);

  describe("core", () => {
    let launcher: LauncherService;

    beforeAll(async () => {
      launcher = new LauncherService(port);
      await launcher.connect();
    }, 15_000);

    afterAll(async () => {
      await forceStopInstance(launcher, accountId, port);
      launcher.disconnect();
    }, 30_000);

    it("starts an instance and returns port", async () => {
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
      const result = await startInstanceWithRecovery(
        launcher,
        accountId,
        port,
      );

      expect(result.status).toBe("already_running");
      expect(result).toHaveProperty("port");
      expect((result as { port: number }).port).toBeGreaterThan(0);
    }, 60_000);

    it("findApp classifies launcher and instance processes", async () => {
      // Ensure instance is running (may already be started by prior test)
      await startInstanceWithRecovery(launcher, accountId, port);

      const apps = await findApp();

      const launchers = apps.filter((a) => a.role === "launcher");
      const instances = apps.filter((a) => a.role === "instance");

      expect(launchers.length).toBeGreaterThanOrEqual(1);
      expect(instances.length).toBeGreaterThanOrEqual(1);

      // The launcher should be the one on our known port
      const launcherMatch = launchers.find((a) => a.cdpPort === port);
      assertDefined(launcherMatch, "Launcher not found on expected port");
      expect(launcherMatch.connectable).toBe(true);
    }, 60_000);

    it("LauncherService.connect rejects instance CDP port with WrongPortError", async () => {
      // Ensure instance is running
      await startInstanceWithRecovery(launcher, accountId, port);

      const instancePort = await discoverInstancePort(port);
      if (instancePort === null) {
        console.log("  skipping: instance CDP port not discoverable");
        return;
      }

      const wrongLauncher = new LauncherService(instancePort);
      await expect(wrongLauncher.connect()).rejects.toThrow(WrongPortError);
    }, 60_000);

    it("instance can be stopped after start", async () => {
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
        await forceStopInstance(launcher, accountId, port);
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

    it(
      "handleStartInstance starts instance and reports CDP port",
      async () => {
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

    it(
      "start-instance tool starts instance and returns CDP port",
      async () => {
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
});
