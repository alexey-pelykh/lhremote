// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { describeE2E, launchApp, quitApp, retryAsync } from "@lhremote/core/testing";
import { AppService, LauncherService } from "@lhremote/core";

// CLI handler
import { handleListAccounts } from "@lhremote/cli/handlers";

describeE2E("list-accounts", () => {
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

    it("listAccounts() returns at least one account", async () => {
      const accounts = await launcher.listAccounts();
      expect(accounts.length, "No accounts configured in LinkedHelper").toBeGreaterThan(0);
    });

    it("listAccounts() returns accounts with expected shape", async () => {
      const accounts = await launcher.listAccounts();
      expect(accounts.length).toBeGreaterThan(0);
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

  describe("CLI handler", () => {
    const originalExitCode = process.exitCode;

    beforeEach(() => {
      process.exitCode = undefined;
    });

    afterEach(() => {
      process.exitCode = originalExitCode;
      vi.restoreAllMocks();
    });

    it("handleListAccounts --json writes valid JSON to stdout", async () => {
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
      await handleListAccounts({ cdpPort: port, json: true });
      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();
      const output = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
      const parsed = JSON.parse(output) as unknown;
      expect(Array.isArray(parsed)).toBe(true);
    });

    it("handleListAccounts prints formatted output", async () => {
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
      await handleListAccounts({ cdpPort: port });
      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).toHaveBeenCalled();
    });
  });
});
