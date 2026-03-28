// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { describeE2E, launchApp, quitApp } from "@lhremote/core/testing";
import { AppService, type Profile } from "@lhremote/core";

// CLI handler
import { handleQueryProfile } from "@lhremote/cli/handlers";

// MCP tool registration
import { registerQueryProfile } from "@lhremote/mcp/tools";
import { createMockServer } from "@lhremote/mcp/testing";

describeE2E("query-profile", () => {
  let app: AppService;

  beforeAll(async () => {
    const launched = await launchApp();
    app = launched.app;
  }, 60_000);

  afterAll(async () => {
    await quitApp(app);
  }, 30_000);

  describe("CLI handler", () => {
    const originalExitCode = process.exitCode;

    beforeEach(() => {
      process.exitCode = undefined;
    });

    afterEach(() => {
      process.exitCode = originalExitCode;
      vi.restoreAllMocks();
    });

    it("handleQueryProfile --json returns cached profile by publicId", async () => {
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

      await handleQueryProfile({ publicId: "williamhgates", includePositions: true, json: true });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
      const parsed = JSON.parse(output) as Profile;

      expect(parsed.miniProfile).toHaveProperty("firstName");
      expect(typeof parsed.miniProfile.firstName).toBe("string");
      expect(parsed.miniProfile.firstName.length).toBeGreaterThan(0);
      expect(Array.isArray(parsed.positions)).toBe(true);
      expect(Array.isArray(parsed.skills)).toBe(true);
    });

    it("handleQueryProfile prints human-friendly output", async () => {
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

      await handleQueryProfile({ publicId: "williamhgates" });

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();

      const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
      expect(output).toMatch(/#\d+/);
    });
  });

  describe("MCP tool", () => {
    it("query-profile tool returns cached profile by publicId", async () => {
      const { server, getHandler } = createMockServer();
      registerQueryProfile(server);

      const handler = getHandler("query-profile");
      const result = (await handler({ publicId: "williamhgates", includePositions: true })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse((result.content[0] as { text: string }).text) as Profile;

      expect(parsed.miniProfile).toHaveProperty("firstName");
      expect(typeof parsed.miniProfile.firstName).toBe("string");
      expect(parsed.miniProfile.firstName.length).toBeGreaterThan(0);
      expect(Array.isArray(parsed.positions)).toBe(true);
      expect(Array.isArray(parsed.skills)).toBe(true);
    });

    it("query-profile tool returns cached profile by personId", async () => {
      // Step 1: get the profile by publicId to extract the numeric id
      const { server: server1, getHandler: getHandler1 } = createMockServer();
      registerQueryProfile(server1);

      const handler1 = getHandler1("query-profile");
      const result1 = (await handler1({ publicId: "williamhgates" })) as {
        content: { type: string; text: string }[];
      };
      const profile1 = JSON.parse((result1.content[0] as { text: string }).text) as Profile;

      // Step 2: query the same profile by its numeric personId
      const { server: server2, getHandler: getHandler2 } = createMockServer();
      registerQueryProfile(server2);

      const handler2 = getHandler2("query-profile");
      const result2 = (await handler2({ personId: profile1.id })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };

      expect(result2.isError).toBeUndefined();
      expect(result2.content).toHaveLength(1);

      const parsed = JSON.parse((result2.content[0] as { text: string }).text) as Profile;
      expect(parsed.id).toBe(profile1.id);
      expect(parsed.miniProfile.firstName).toBe(profile1.miniProfile.firstName);
    });
  });
});
