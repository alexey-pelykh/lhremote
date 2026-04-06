// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { describeE2E, launchApp, quitApp } from "@lhremote/core/testing";
import { type AppService, type DismissErrorsOutput, dismissErrors } from "@lhremote/core";
import { handleDismissErrors, handleLaunchApp } from "@lhremote/cli/handlers";
import { registerDismissErrors, registerLaunchApp } from "@lhremote/mcp/tools";
import { createMockServer } from "@lhremote/mcp/testing";

describeE2E("Error handling and lifecycle", () => {
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

  describe("launch-app", () => {
    describe("core", () => {
      it("reports running after launch", async () => {
        expect(port).toBeGreaterThan(0);
        const running = await app.isRunning();
        expect(running).toBe(true);
      }, 30_000);
    });

    describe("CLI handler", () => {
      const originalExitCode = process.exitCode;

      beforeEach(() => {
        process.exitCode = undefined;
      });

      afterEach(() => {
        process.exitCode = originalExitCode;
        vi.restoreAllMocks();
      });

      it("handleLaunchApp prints CDP port on success", async () => {
        const stdoutSpy = vi
          .spyOn(process.stdout, "write")
          .mockReturnValue(true);

        await handleLaunchApp();

        expect(process.exitCode).toBeUndefined();
        expect(stdoutSpy).toHaveBeenCalled();

        const output = stdoutSpy.mock.calls
          .map((call) => String(call[0]))
          .join("");
        expect(output).toMatch(/LinkedHelper launched on CDP port \d+/);
      }, 60_000);
    });

    describe("MCP tool", () => {
      it("launch-app tool returns success with CDP port", async () => {
        const { server, getHandler } = createMockServer();
        registerLaunchApp(server);

        const handler = getHandler("launch-app");
        const result = (await handler({})) as {
          isError?: boolean;
          content: { type: string; text: string }[];
        };

        expect(result.isError, `MCP tool error: ${result.content?.[0]?.text}`).toBeUndefined();
        expect(result.content).toHaveLength(1);

        const text = (result.content[0] as { text: string }).text;
        expect(text).toMatch(/LinkedHelper launched on CDP port \d+/);
      }, 60_000);
    });
  });

  describe("dismiss-errors", () => {
    describe("core", () => {
      it("returns dismissed=0 when no errors present", async () => {
        const result = await dismissErrors({ cdpPort: port });

        expect(result.accountId).toBeGreaterThan(0);
        expect(result.dismissed).toBe(0);
        expect(result.nonDismissable).toBeGreaterThanOrEqual(0);
      }, 30_000);
    });

    describe("CLI handler", () => {
      const originalExitCode = process.exitCode;

      beforeEach(() => {
        process.exitCode = undefined;
      });

      afterEach(() => {
        process.exitCode = originalExitCode;
        vi.restoreAllMocks();
      });

      it("handleDismissErrors prints account and dismissed count", async () => {
        const stdoutSpy = vi
          .spyOn(process.stdout, "write")
          .mockReturnValue(true);

        await handleDismissErrors({ cdpPort: port });

        expect(process.exitCode).toBeUndefined();
        expect(stdoutSpy).toHaveBeenCalled();

        const output = stdoutSpy.mock.calls
          .map((call) => String(call[0]))
          .join("");
        expect(output).toMatch(/Account: \d+/);
        expect(output).toMatch(/Dismissed: \d+/);
      }, 30_000);

      it("handleDismissErrors --json writes valid JSON", async () => {
        const stdoutSpy = vi
          .spyOn(process.stdout, "write")
          .mockReturnValue(true);

        await handleDismissErrors({ cdpPort: port, json: true });

        expect(process.exitCode).toBeUndefined();
        expect(stdoutSpy).toHaveBeenCalled();

        const output = stdoutSpy.mock.calls
          .map((call) => String(call[0]))
          .join("");
        const parsed = JSON.parse(output) as DismissErrorsOutput;
        expect(parsed.accountId).toBeGreaterThan(0);
        expect(parsed.dismissed).toBeGreaterThanOrEqual(0);
        expect(parsed.nonDismissable).toBeGreaterThanOrEqual(0);
      }, 30_000);
    });

    describe("MCP tool", () => {
      it("dismiss-errors tool returns JSON result", async () => {
        const { server, getHandler } = createMockServer();
        registerDismissErrors(server);

        const handler = getHandler("dismiss-errors");
        const result = (await handler({ cdpPort: port })) as {
          isError?: boolean;
          content: { type: string; text: string }[];
        };

        expect(result.isError, `MCP tool error: ${result.content?.[0]?.text}`).toBeUndefined();
        expect(result.content).toHaveLength(1);

        const parsed = JSON.parse(
          (result.content[0] as { text: string }).text,
        ) as DismissErrorsOutput;
        expect(parsed.accountId).toBeGreaterThan(0);
        expect(parsed.dismissed).toBeGreaterThanOrEqual(0);
        expect(parsed.nonDismissable).toBeGreaterThanOrEqual(0);
      }, 30_000);
    });
  });
});
