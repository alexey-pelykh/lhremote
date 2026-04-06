// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { describeE2E, forceStopInstance, launchApp, quitApp, resolveAccountId, retryAsync } from "@lhremote/core/testing";
import { type AppService, LauncherService, startInstanceWithRecovery } from "@lhremote/core";

// CLI handler
import { handleGetErrors } from "@lhremote/cli/handlers";

// MCP tool registration
import { registerGetErrors } from "@lhremote/mcp/tools";
import { createMockServer } from "@lhremote/mcp/testing";

describeE2E("get-errors operation", () => {
  let app: AppService;
  let port: number;
  let accountId: number;

  beforeAll(async () => {
    const launched = await launchApp();
    app = launched.app;
    port = launched.port;

    accountId = await resolveAccountId(port);
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

  // -----------------------------------------------------------------------
  // Instance stopped (launcher only)
  // -----------------------------------------------------------------------

  describe("with instance stopped", () => {
    describe("CLI handlers", () => {
      const originalExitCode = process.exitCode;

      beforeEach(() => {
        process.exitCode = undefined;
      });

      afterEach(() => {
        process.exitCode = originalExitCode;
        vi.restoreAllMocks();
      });

      it("get-errors --json returns valid JSON shape", async () => {
        const stdoutSpy = vi
          .spyOn(process.stdout, "write")
          .mockReturnValue(true);

        await handleGetErrors({ cdpPort: port, json: true });

        expect(process.exitCode).toBeUndefined();
        expect(stdoutSpy).toHaveBeenCalled();

        const output = stdoutSpy.mock.calls
          .map((call) => String(call[0]))
          .join("");
        const parsed = JSON.parse(output) as {
          accountId: number;
          healthy: boolean;
          issues: unknown[];
          popup: unknown;
        };

        expect(parsed.accountId).toBeGreaterThan(0);
        expect(typeof parsed.healthy).toBe("boolean");
        expect(Array.isArray(parsed.issues)).toBe(true);
      }, 30_000);

      it("get-errors prints human-friendly output", async () => {
        const stdoutSpy = vi
          .spyOn(process.stdout, "write")
          .mockReturnValue(true);

        await handleGetErrors({ cdpPort: port });

        expect(process.exitCode).toBeUndefined();
        expect(stdoutSpy).toHaveBeenCalled();

        const output = stdoutSpy.mock.calls
          .map((call) => String(call[0]))
          .join("");
        expect(output).toContain("Health:");
        expect(output).toContain("Account:");
        expect(output).toContain("Issues:");
        expect(output).toContain("Popup:");
      }, 30_000);
    });

    describe("MCP tools", () => {
      it("get-errors tool returns valid JSON", async () => {
        const { server, getHandler } = createMockServer();
        registerGetErrors(server);

        const handler = getHandler("get-errors");
        const result = (await handler({ cdpPort: port })) as {
          isError?: boolean;
          content: { type: string; text: string }[];
        };

        expect(result.isError, `MCP tool error: ${result.content?.[0]?.text}`).toBeUndefined();
        expect(result.content).toHaveLength(1);

        const parsed = JSON.parse(
          (result.content[0] as { text: string }).text,
        ) as {
          accountId: number;
          healthy: boolean;
          issues: unknown[];
          popup: unknown;
        };

        expect(parsed.accountId).toBeGreaterThan(0);
        expect(typeof parsed.healthy).toBe("boolean");
        expect(Array.isArray(parsed.issues)).toBe(true);
      }, 30_000);
    });
  });

  // -----------------------------------------------------------------------
  // Instance running
  // -----------------------------------------------------------------------

  describe("with instance running", () => {
    beforeAll(async () => {
      const launcher = new LauncherService(port);
      await retryAsync(() => launcher.connect(), { retries: 3, delay: 1_000 });
      await startInstanceWithRecovery(launcher, accountId, port);
      launcher.disconnect();
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
    }, 60_000);

    describe("CLI handlers", () => {
      const originalExitCode = process.exitCode;

      beforeEach(() => {
        process.exitCode = undefined;
      });

      afterEach(() => {
        process.exitCode = originalExitCode;
        vi.restoreAllMocks();
      });

      it("get-errors --json returns valid JSON shape", async () => {
        const stdoutSpy = vi
          .spyOn(process.stdout, "write")
          .mockReturnValue(true);

        await handleGetErrors({ cdpPort: port, json: true });

        expect(process.exitCode).toBeUndefined();
        expect(stdoutSpy).toHaveBeenCalled();

        const output = stdoutSpy.mock.calls
          .map((call) => String(call[0]))
          .join("");
        const parsed = JSON.parse(output) as {
          accountId: number;
          healthy: boolean;
          issues: unknown[];
          popup: unknown;
        };

        expect(parsed.accountId).toBeGreaterThan(0);
        expect(typeof parsed.healthy).toBe("boolean");
        expect(Array.isArray(parsed.issues)).toBe(true);
      }, 30_000);

      it("get-errors prints human-friendly output", async () => {
        const stdoutSpy = vi
          .spyOn(process.stdout, "write")
          .mockReturnValue(true);

        await handleGetErrors({ cdpPort: port });

        expect(process.exitCode).toBeUndefined();
        expect(stdoutSpy).toHaveBeenCalled();

        const output = stdoutSpy.mock.calls
          .map((call) => String(call[0]))
          .join("");
        expect(output).toContain("Health:");
        expect(output).toContain("Account:");
        expect(output).toContain("Issues:");
        expect(output).toContain("Popup:");
      }, 30_000);
    });

    describe("MCP tools", () => {
      it("get-errors tool returns valid JSON", async () => {
        const { server, getHandler } = createMockServer();
        registerGetErrors(server);

        const handler = getHandler("get-errors");
        const result = (await handler({ cdpPort: port })) as {
          isError?: boolean;
          content: { type: string; text: string }[];
        };

        expect(result.isError, `MCP tool error: ${result.content?.[0]?.text}`).toBeUndefined();
        expect(result.content).toHaveLength(1);

        const parsed = JSON.parse(
          (result.content[0] as { text: string }).text,
        ) as {
          accountId: number;
          healthy: boolean;
          issues: unknown[];
          popup: unknown;
        };

        expect(parsed.accountId).toBeGreaterThan(0);
        expect(typeof parsed.healthy).toBe("boolean");
        expect(Array.isArray(parsed.issues)).toBe(true);
      }, 30_000);
    });
  });
});
