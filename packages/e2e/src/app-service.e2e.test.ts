// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { describeE2E, launchApp, quitApp, retryAsync } from "@lhremote/core/testing";
import { AppService, discoverTargets } from "@lhremote/core";
import { handleQuitApp } from "@lhremote/cli/handlers";

describeE2E("AppService", () => {
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

  describe("lifecycle", () => {
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

  describe("shutdown", () => {
    it(
      "quit() stops the application",
      async () => {
        await app.quit();

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
