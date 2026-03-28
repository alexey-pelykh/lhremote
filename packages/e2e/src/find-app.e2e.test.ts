// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertDefined, describeE2E, launchApp, quitApp } from "@lhremote/core/testing";
import { AppService, findApp } from "@lhremote/core";
import type { DiscoveredApp } from "@lhremote/core";
import { handleFindApp } from "@lhremote/cli/handlers";
import { registerFindApp } from "@lhremote/mcp/tools";
import { createMockServer } from "@lhremote/mcp/testing";

describeE2E("find-app", () => {
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

    it("classifies launcher process with role 'launcher'", async () => {
      const apps = await findApp();
      const match = apps.find((a) => a.cdpPort === port);
      assertDefined(match, `Expected findApp to discover port ${String(port)}`);
      expect(match.role).toBe("launcher");
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

    it("handleFindApp --json writes valid JSON to stdout", async () => {
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
      await handleFindApp({ json: true });
      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();
      const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
      const parsed = JSON.parse(output) as DiscoveredApp[];
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThan(0);
      const match = parsed.find((a) => a.cdpPort === port);
      assertDefined(match, `Expected findApp to discover port ${String(port)}`);
      expect(match.connectable).toBe(true);
    });

    it("handleFindApp prints human-friendly output", async () => {
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
      await handleFindApp({});
      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();
      const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
      expect(output).toMatch(/PID \d+/);
      expect(output).toContain("connectable");
    });
  });

  describe("MCP tool", () => {
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
      const parsed = JSON.parse((result.content[0] as { text: string }).text) as DiscoveredApp[];
      expect(parsed.length).toBeGreaterThan(0);
      const match = parsed.find((a) => a.cdpPort === port);
      assertDefined(match, `Expected findApp to discover port ${String(port)}`);
      expect(match.connectable).toBe(true);
    });
  });
});
