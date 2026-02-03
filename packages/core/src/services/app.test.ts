import { type ChildProcess, spawn } from "node:child_process";
import { accessSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppLaunchError, AppNotFoundError } from "./errors.js";
import { AppService } from "./app.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

vi.mock("node:fs", () => ({
  accessSync: vi.fn(),
  constants: { X_OK: 1 },
}));

vi.mock("../cdp/index.js", () => ({
  discoverTargets: vi.fn(),
}));

vi.mock("get-port", () => ({
  default: vi.fn(),
}));

import { discoverTargets } from "../cdp/index.js";
import getPort from "get-port";

const mockedSpawn = vi.mocked(spawn);
const mockedAccessSync = vi.mocked(accessSync);
const mockedDiscoverTargets = vi.mocked(discoverTargets);
const mockedGetPort = vi.mocked(getPort);

/** Use zero probe delay in tests to avoid 3s waits. */
const FAST_OPTIONS = { launchProbeDelay: 0 };

function makeMockChild(): ChildProcess {
  type Listener = (...args: unknown[]) => void;
  const listeners = new Map<string, Set<Listener>>();

  const child = {
    unref: vi.fn(),
    kill: vi.fn(),
    on: vi.fn((event: string, handler: Listener) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      (listeners.get(event) as Set<Listener>).add(handler);
      return child;
    }),
    removeListener: vi.fn((event: string, handler: Listener) => {
      listeners.get(event)?.delete(handler);
      return child;
    }),
    pid: 12345,
    exitCode: null as number | null,
  } as unknown as ChildProcess;

  // Helper to simulate process exit from tests
  (child as unknown as { _emitExit: (code: number) => void })._emitExit = (code: number) => {
    (child as unknown as { exitCode: number | null }).exitCode = code;
    for (const handler of listeners.get("exit") ?? []) {
      handler(code, null);
    }
  };

  return child;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env["LINKEDHELPER_PATH"];
});

describe("AppService", () => {
  describe("cdpPort getter", () => {
    it("returns the explicit port when provided", () => {
      const service = new AppService(9222);
      expect(service.cdpPort).toBe(9222);
    });

    it("throws when no port assigned and launch() not called", () => {
      const service = new AppService();
      expect(() => service.cdpPort).toThrow(/call launch\(\) first/);
    });
  });

  describe("findBinary", () => {
    it("returns the darwin path on macOS", () => {
      vi.stubGlobal("process", { ...process, platform: "darwin", env: {} });
      mockedAccessSync.mockReturnValue(undefined);

      const result = AppService.findBinary();

      expect(result).toBe(
        "/Applications/linked-helper.app/Contents/MacOS/linked-helper",
      );
    });

    it("returns the win32 path on Windows", () => {
      vi.stubGlobal("process", {
        ...process,
        platform: "win32",
        env: { LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" },
      });
      mockedAccessSync.mockReturnValue(undefined);

      const result = AppService.findBinary();

      expect(result).toContain("linked-helper.exe");
      expect(result).toContain("Local");
    });

    it("returns the linux path on Linux", () => {
      vi.stubGlobal("process", { ...process, platform: "linux", env: {} });
      mockedAccessSync.mockReturnValue(undefined);

      const result = AppService.findBinary();

      expect(result).toBe("/opt/linked-helper/linked-helper");
    });

    it("uses LINKEDHELPER_PATH env override", () => {
      vi.stubGlobal("process", {
        ...process,
        platform: "darwin",
        env: { LINKEDHELPER_PATH: "/custom/path/lh" },
      });
      mockedAccessSync.mockReturnValue(undefined);

      const result = AppService.findBinary();

      expect(result).toBe("/custom/path/lh");
    });

    it("throws AppNotFoundError when binary does not exist", () => {
      vi.stubGlobal("process", { ...process, platform: "darwin", env: {} });
      mockedAccessSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });

      expect(() => AppService.findBinary()).toThrow(AppNotFoundError);
    });
  });

  describe("isRunning", () => {
    it("returns true when CDP endpoint responds", async () => {
      const service = new AppService(9222);
      mockedDiscoverTargets.mockResolvedValue([]);

      expect(await service.isRunning()).toBe(true);
    });

    it("returns false when CDP endpoint is unreachable", async () => {
      const service = new AppService(9222);
      mockedDiscoverTargets.mockRejectedValue(new Error("connection refused"));

      expect(await service.isRunning()).toBe(false);
    });

    it("returns false when no port is assigned", async () => {
      const service = new AppService();

      expect(await service.isRunning()).toBe(false);
    });
  });

  describe("launch", () => {
    beforeEach(() => {
      vi.stubGlobal("process", { ...process, platform: "darwin", env: {} });
    });

    it("skips launch if already running with explicit port", async () => {
      const service = new AppService(9222, FAST_OPTIONS);
      mockedDiscoverTargets.mockResolvedValue([]);

      await service.launch();

      expect(mockedSpawn).not.toHaveBeenCalled();
    });

    it("spawns the binary with explicit CDP port argument", async () => {
      const service = new AppService(9222, FAST_OPTIONS);
      mockedDiscoverTargets.mockRejectedValue(new Error("not running"));
      mockedAccessSync.mockReturnValue(undefined);

      const child = makeMockChild();
      mockedSpawn.mockReturnValue(child);

      await service.launch();

      expect(mockedSpawn).toHaveBeenCalledWith(
        "/Applications/linked-helper.app/Contents/MacOS/linked-helper",
        ["--remote-debugging-port=9222"],
        { detached: true, stdio: "ignore" },
      );
      expect(child.unref).toHaveBeenCalled();
    });

    it("selects a free port via get-port when no port provided", async () => {
      const service = new AppService(undefined, FAST_OPTIONS);
      mockedGetPort.mockResolvedValue(54321);
      mockedAccessSync.mockReturnValue(undefined);

      const child = makeMockChild();
      mockedSpawn.mockReturnValue(child);

      await service.launch();

      expect(mockedGetPort).toHaveBeenCalled();
      expect(mockedSpawn).toHaveBeenCalledWith(
        expect.any(String),
        ["--remote-debugging-port=54321"],
        { detached: true, stdio: "ignore" },
      );
      expect(service.cdpPort).toBe(54321);
    });

    it("reuses assigned port on second launch() call", async () => {
      const service = new AppService(undefined, FAST_OPTIONS);
      mockedGetPort.mockResolvedValue(54321);
      mockedAccessSync.mockReturnValue(undefined);

      const child = makeMockChild();
      mockedSpawn.mockReturnValue(child);
      await service.launch();

      expect(service.cdpPort).toBe(54321);

      // Reset call counts for second launch assertions
      mockedGetPort.mockClear();
      mockedSpawn.mockClear();

      // Second launch — port is already assigned, app reported as running
      mockedDiscoverTargets.mockResolvedValue([]);
      await service.launch();

      // getPort must not be called again — port was already assigned
      expect(mockedGetPort).not.toHaveBeenCalled();
      // spawn must not be called again — app is already running
      expect(mockedSpawn).not.toHaveBeenCalled();
      expect(service.cdpPort).toBe(54321);
    });

    it("throws AppLaunchError on spawn error", async () => {
      const service = new AppService(9222, FAST_OPTIONS);
      mockedDiscoverTargets.mockRejectedValue(new Error("not running"));
      mockedAccessSync.mockReturnValue(undefined);

      const child = makeMockChild();
      (child.on as ReturnType<typeof vi.fn>).mockImplementation(
        (event: string, handler: (err: Error) => void) => {
          if (event === "error") {
            queueMicrotask(() => handler(new Error("ENOENT")));
          }
          return child;
        },
      );
      mockedSpawn.mockReturnValue(child);

      await expect(service.launch()).rejects.toThrow(AppLaunchError);
    });
  });

  describe("quit", () => {
    beforeEach(() => {
      vi.stubGlobal("process", { ...process, platform: "darwin", env: {} });
    });

    it("sends SIGTERM and waits for exit", async () => {
      const service = new AppService(9222, FAST_OPTIONS);
      mockedDiscoverTargets.mockRejectedValue(new Error("not running"));
      mockedAccessSync.mockReturnValue(undefined);

      const child = makeMockChild();
      const emitExit = (child as unknown as { _emitExit: (code: number) => void })._emitExit;

      // Simulate process exiting shortly after SIGTERM
      (child.kill as ReturnType<typeof vi.fn>).mockImplementation(() => {
        queueMicrotask(() => emitExit(0));
      });
      mockedSpawn.mockReturnValue(child);

      await service.launch();
      await service.quit();

      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    });

    it("escalates to SIGKILL when process does not exit after SIGTERM", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      const service = new AppService(9222, FAST_OPTIONS);
      mockedDiscoverTargets.mockRejectedValue(new Error("not running"));
      mockedAccessSync.mockReturnValue(undefined);

      const child = makeMockChild();
      const emitExit = (child as unknown as { _emitExit: (code: number) => void })._emitExit;

      let killCount = 0;
      (child.kill as ReturnType<typeof vi.fn>).mockImplementation(() => {
        killCount++;
        // Only exit on SIGKILL (second kill call)
        if (killCount === 2) {
          queueMicrotask(() => emitExit(137));
        }
      });
      mockedSpawn.mockReturnValue(child);

      await service.launch();

      const quitPromise = service.quit();
      // Advance past the graceful timeout
      await vi.advanceTimersByTimeAsync(11_000);
      await quitPromise;

      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");

      vi.useRealTimers();
    });

    it("falls back to CDP close when no spawned process", async () => {
      const service = new AppService(9222);
      mockedDiscoverTargets.mockResolvedValue([
        {
          id: "T1",
          type: "page",
          title: "",
          url: "",
          description: "",
          devtoolsFrontendUrl: "",
        },
      ]);

      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", mockFetch);

      await service.quit();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://127.0.0.1:9222/json/close/T1",
      );
    });

    it("does not throw when CDP close fails", async () => {
      const service = new AppService(9222);
      mockedDiscoverTargets.mockRejectedValue(new Error("not running"));

      await expect(service.quit()).resolves.toBeUndefined();
    });

    it("does nothing when no port assigned and no child process", async () => {
      const service = new AppService();

      await expect(service.quit()).resolves.toBeUndefined();
    });
  });
});
