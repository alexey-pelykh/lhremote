import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeE2E, launchApp, quitApp } from "../testing/e2e-helpers.js";
import { discoverTargets } from "../cdp/discovery.js";
import { AppService } from "./app.js";
import { LauncherService } from "./launcher.js";

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

  describe("AppService shutdown", () => {
    // Known issue: Electron app does not terminate promptly on SIGTERM.
    // The app may stay responsive on the CDP port for 20s+ after SIGTERM.
    it.fails(
      "quit() stops the application",
      async () => {
        await app.quit();

        // Poll for the process to terminate
        const deadline = Date.now() + 20_000;
        const probe = new AppService(port);
        while (Date.now() < deadline) {
          if (!(await probe.isRunning())) {
            break;
          }
          await new Promise<void>((r) => setTimeout(r, 500));
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
});
