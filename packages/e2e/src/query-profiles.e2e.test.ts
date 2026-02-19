// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeE2E } from "@lhremote/core/testing";

// CLI handler
import { handleQueryProfiles } from "@lhremote/cli/handlers";

// MCP tool registration
import { registerQueryProfiles } from "@lhremote/mcp/tools";
import { createMockServer } from "@lhremote/mcp/testing";

describeE2E("query-profiles operation", () => {
  describe("CLI handlers", () => {
    const originalExitCode = process.exitCode;

    beforeEach(() => {
      process.exitCode = undefined;
    });

    afterEach(() => {
      process.exitCode = originalExitCode;
      vi.restoreAllMocks();
    });

    it("query-profiles --json returns valid JSON shape", async () => {
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleQueryProfiles({ json: true });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      const parsed = JSON.parse(output) as {
        profiles: unknown[];
        total: number;
        limit: number;
        offset: number;
      };

      expect(Array.isArray(parsed.profiles)).toBe(true);
      expect(parsed.profiles.length).toBeGreaterThan(0);
      expect(parsed.total).toBeGreaterThan(0);
      expect(parsed.limit).toBe(20);
      expect(parsed.offset).toBe(0);

      const profile = parsed.profiles[0] as Record<string, unknown>;
      expect(profile).toHaveProperty("id");
      expect(profile).toHaveProperty("firstName");
    }, 30_000);

    it("query-profiles --query filters by name", async () => {
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleQueryProfiles({ query: "Gates", json: true });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      const parsed = JSON.parse(output) as {
        profiles: { id: number; firstName: string; lastName: string | null }[];
        total: number;
      };

      expect(parsed.profiles.length).toBeGreaterThan(0);
      expect(parsed.total).toBeGreaterThan(0);
    }, 30_000);

    it("query-profiles --limit respects limit", async () => {
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleQueryProfiles({ limit: 5, json: true });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      const parsed = JSON.parse(output) as {
        profiles: unknown[];
        total: number;
        limit: number;
      };

      expect(parsed.profiles.length).toBeLessThanOrEqual(5);
      expect(parsed.limit).toBe(5);
    }, 30_000);

    it("query-profiles prints human-friendly output", async () => {
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockReturnValue(true);

      await handleQueryProfiles({});

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      expect(output).toContain("Profiles matching");
      expect(output).toMatch(/#\d+\s/);
    }, 30_000);
  });

  describe("MCP tools", () => {
    it("query-profiles tool returns valid JSON", async () => {
      const { server, getHandler } = createMockServer();
      registerQueryProfiles(server);

      const handler = getHandler("query-profiles");
      const result = (await handler({})) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(
        (result.content[0] as { text: string }).text,
      ) as {
        profiles: unknown[];
        total: number;
        limit: number;
        offset: number;
      };

      expect(Array.isArray(parsed.profiles)).toBe(true);
      expect(parsed.profiles.length).toBeGreaterThan(0);
      expect(parsed.total).toBeGreaterThan(0);
    }, 30_000);

    it("query-profiles tool filters by query", async () => {
      const { server, getHandler } = createMockServer();
      registerQueryProfiles(server);

      const handler = getHandler("query-profiles");
      const result = (await handler({ query: "Gates" })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(
        (result.content[0] as { text: string }).text,
      ) as {
        profiles: { id: number; firstName: string }[];
        total: number;
      };

      expect(parsed.profiles.length).toBeGreaterThan(0);
    }, 30_000);

    it("query-profiles tool respects limit", async () => {
      const { server, getHandler } = createMockServer();
      registerQueryProfiles(server);

      const handler = getHandler("query-profiles");
      const result = (await handler({ limit: 5 })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(
        (result.content[0] as { text: string }).text,
      ) as {
        profiles: unknown[];
        limit: number;
      };

      expect(parsed.profiles.length).toBeLessThanOrEqual(5);
      expect(parsed.limit).toBe(5);
    }, 30_000);
  });
});
