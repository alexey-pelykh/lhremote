// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { describeE2E, launchApp, quitApp, retryAsync } from "@lhremote/core/testing";
import { AppService, checkStatus, type StatusReport } from "@lhremote/core";

// CLI handler
import { handleCheckStatus } from "@lhremote/cli/handlers";

// MCP tool registration
import { registerCheckStatus } from "@lhremote/mcp/tools";
import { createMockServer } from "@lhremote/mcp/testing";

describeE2E("check-status", () => {
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

  describe("core", () => {
    it("reports launcher as reachable", async () => {
      const report = await retryAsync(async () => {
        const r = await checkStatus(port);
        if (!r.launcher.reachable) throw new Error("Launcher not reachable yet");
        return r;
      });
      expect(report.launcher.reachable).toBe(true);
      expect(report.launcher.port).toBe(port);
    });

    it("reports accounts with expected shape", async () => {
      const report = await checkStatus(port);
      for (const instance of report.instances) {
        expect(instance).toHaveProperty("accountId");
        expect(instance).toHaveProperty("accountName");
        expect(instance).toHaveProperty("cdpPort");
      }
    });

    it("reports databases", async () => {
      const report = await checkStatus(port);
      expect(report.databases.length, "No databases found").toBeGreaterThan(0);
      for (const db of report.databases) {
        expect(db).toHaveProperty("accountId");
        expect(db).toHaveProperty("path");
        expect(db).toHaveProperty("profileCount");
        expect(db.profileCount).toBeGreaterThanOrEqual(0);
      }
    });
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

    it("handleCheckStatus --json writes valid JSON to stdout", async () => {
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
      await handleCheckStatus({ cdpPort: port, json: true });
      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();
      const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
      const parsed = JSON.parse(output) as StatusReport;
      expect(parsed.launcher.reachable).toBe(true);
    });

    it("handleCheckStatus prints human-friendly output", async () => {
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
      await handleCheckStatus({ cdpPort: port });
      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();
      const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
      expect(output).toContain("Launcher: reachable");
    });
  });

  describe("MCP tool", () => {
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
      const parsed = JSON.parse((result.content[0] as { text: string }).text) as StatusReport;
      expect(parsed.launcher.reachable).toBe(true);
      expect(parsed.launcher.port).toBe(port);
    });
  });
});
