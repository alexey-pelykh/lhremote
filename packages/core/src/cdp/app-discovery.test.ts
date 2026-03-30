// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findApp, resolveAppPort, resolveInstancePort, resolveLauncherPort } from "./app-discovery.js";
import { LinkedHelperNotRunningError, LinkedHelperUnreachableError } from "../services/errors.js";

vi.mock("pid-port", () => ({
  pidToPorts: vi.fn(),
}));

vi.mock("ps-list", () => ({
  default: vi.fn(),
}));

import { pidToPorts } from "pid-port";
import psList from "ps-list";

describe("findApp", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("[]", { status: 200 }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return empty array when no LinkedHelper process is running", async () => {
    vi.mocked(psList).mockResolvedValue([
      { pid: 100, name: "chrome", ppid: 1 },
      { pid: 200, name: "node", ppid: 1 },
    ]);

    const result = await findApp();
    expect(result).toEqual([]);
  });

  it("should return empty array when psList throws", async () => {
    vi.mocked(psList).mockRejectedValue(new Error("permission denied"));

    const result = await findApp();
    expect(result).toEqual([]);
  });

  it("should discover a linked-helper process with CDP port", async () => {
    vi.mocked(psList).mockResolvedValue([
      { pid: 1000, name: "linked-helper", ppid: 1 },
    ]);
    vi.mocked(pidToPorts).mockResolvedValue(new Set([9222]) as never);

    const result = await findApp();
    expect(result).toEqual([
      { pid: 1000, cdpPort: 9222, connectable: true, role: "launcher" },
    ]);
  });

  it("should discover a linked-helper.exe process on Windows", async () => {
    vi.mocked(psList).mockResolvedValue([
      { pid: 2000, name: "linked-helper.exe", ppid: 1 },
    ]);
    vi.mocked(pidToPorts).mockResolvedValue(new Set([9333]) as never);

    const result = await findApp();
    expect(result).toEqual([
      { pid: 2000, cdpPort: 9333, connectable: true, role: "launcher" },
    ]);
  });

  it("should discover multiple LinkedHelper processes", async () => {
    vi.mocked(psList).mockResolvedValue([
      { pid: 1000, name: "linked-helper", ppid: 1 },
      { pid: 2000, name: "linked-helper", ppid: 1 },
    ]);
    vi.mocked(pidToPorts)
      .mockResolvedValueOnce(new Set([9222]) as never)
      .mockResolvedValueOnce(new Set([9333]) as never);

    const result = await findApp();
    expect(result).toEqual([
      { pid: 1000, cdpPort: 9222, connectable: true, role: "launcher" },
      { pid: 2000, cdpPort: 9333, connectable: true, role: "launcher" },
    ]);
  });

  it("should classify child process as instance", async () => {
    vi.mocked(psList).mockResolvedValue([
      { pid: 1000, name: "linked-helper", ppid: 1 },
      { pid: 2000, name: "linked-helper", ppid: 1000 },
    ]);
    vi.mocked(pidToPorts)
      .mockResolvedValueOnce(new Set([9222]) as never)
      .mockResolvedValueOnce(new Set([55660]) as never);

    const result = await findApp();
    expect(result).toEqual([
      { pid: 1000, cdpPort: 9222, connectable: true, role: "launcher" },
      { pid: 2000, cdpPort: 55660, connectable: true, role: "instance" },
    ]);
  });

  it("should return connectable false when CDP probe fails", async () => {
    vi.mocked(psList).mockResolvedValue([
      { pid: 1000, name: "linked-helper", ppid: 1 },
    ]);
    vi.mocked(pidToPorts).mockResolvedValue(new Set([9222]) as never);
    vi.mocked(globalThis.fetch).mockRejectedValue(
      new Error("ECONNREFUSED"),
    );

    const result = await findApp();
    expect(result).toEqual([
      { pid: 1000, cdpPort: 9222, connectable: false, role: "launcher" },
    ]);
  });

  it("should return cdpPort null when pidToPorts throws", async () => {
    vi.mocked(psList).mockResolvedValue([
      { pid: 1000, name: "linked-helper", ppid: 1 },
    ]);
    vi.mocked(pidToPorts).mockRejectedValue(new Error("failed"));

    const result = await findApp();
    expect(result).toEqual([
      { pid: 1000, cdpPort: null, connectable: false, role: "launcher" },
    ]);
  });

  it("should return cdpPort null when process has no listening ports", async () => {
    vi.mocked(psList).mockResolvedValue([
      { pid: 1000, name: "linked-helper", ppid: 1 },
    ]);
    vi.mocked(pidToPorts).mockResolvedValue(new Set() as never);

    const result = await findApp();
    expect(result).toEqual([
      { pid: 1000, cdpPort: null, connectable: false, role: "launcher" },
    ]);
  });

  it("should find CDP port among multiple listening ports", async () => {
    vi.mocked(psList).mockResolvedValue([
      { pid: 1000, name: "linked-helper", ppid: 1 },
    ]);
    vi.mocked(pidToPorts).mockResolvedValue(
      new Set([8080, 9222]) as never,
    );

    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes(":8080/")) {
        throw new Error("ECONNREFUSED");
      }
      return new Response("[]", { status: 200 });
    });

    const result = await findApp();
    expect(result).toEqual([
      { pid: 1000, cdpPort: 9222, connectable: true, role: "launcher" },
    ]);
  });

  it("should not match processes with similar but different names", async () => {
    vi.mocked(psList).mockResolvedValue([
      { pid: 100, name: "linked-helper-updater", ppid: 1 },
      { pid: 200, name: "my-linked-helper", ppid: 1 },
    ]);

    const result = await findApp();
    expect(result).toEqual([]);
  });
});

describe("resolveAppPort", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("[]", { status: 200 }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return port when connectable process with matching role exists", async () => {
    vi.mocked(psList).mockResolvedValue([
      { pid: 1000, name: "linked-helper", ppid: 1 },
      { pid: 2000, name: "linked-helper", ppid: 1000 },
    ]);
    vi.mocked(pidToPorts)
      .mockResolvedValueOnce(new Set([9222]) as never)
      .mockResolvedValueOnce(new Set([55660]) as never);

    const port = await resolveAppPort("instance");
    expect(port).toBe(55660);
  });

  it("should return launcher port when launcher role requested", async () => {
    vi.mocked(psList).mockResolvedValue([
      { pid: 1000, name: "linked-helper", ppid: 1 },
      { pid: 2000, name: "linked-helper", ppid: 1000 },
    ]);
    vi.mocked(pidToPorts)
      .mockResolvedValueOnce(new Set([9222]) as never)
      .mockResolvedValueOnce(new Set([55660]) as never);

    const port = await resolveAppPort("launcher");
    expect(port).toBe(9222);
  });

  it("should throw LinkedHelperNotRunningError when no processes found", async () => {
    vi.mocked(psList).mockResolvedValue([]);

    await expect(resolveAppPort("instance")).rejects.toThrow(LinkedHelperNotRunningError);
  });

  it("should throw LinkedHelperUnreachableError when processes found but none connectable with role", async () => {
    vi.mocked(psList).mockResolvedValue([
      { pid: 1000, name: "linked-helper", ppid: 1 },
    ]);
    vi.mocked(pidToPorts).mockResolvedValue(new Set([9222]) as never);
    // Only launcher found — request instance
    const port = await resolveAppPort("launcher");
    expect(port).toBe(9222);

    // Now test the failure case — no instance process
    await expect(resolveAppPort("instance")).rejects.toThrow(LinkedHelperUnreachableError);
  });

  it("should select correct role (launcher vs instance)", async () => {
    vi.mocked(psList).mockResolvedValue([
      { pid: 1000, name: "linked-helper", ppid: 1 },
      { pid: 2000, name: "linked-helper", ppid: 1000 },
    ]);
    vi.mocked(pidToPorts)
      .mockResolvedValueOnce(new Set([9222]) as never)
      .mockResolvedValueOnce(new Set([55660]) as never);

    // First call discovers both
    const instancePort = await resolveAppPort("instance");
    expect(instancePort).toBe(55660);

    // Reset mocks for second call
    vi.mocked(psList).mockResolvedValue([
      { pid: 1000, name: "linked-helper", ppid: 1 },
      { pid: 2000, name: "linked-helper", ppid: 1000 },
    ]);
    vi.mocked(pidToPorts)
      .mockResolvedValueOnce(new Set([9222]) as never)
      .mockResolvedValueOnce(new Set([55660]) as never);

    const launcherPort = await resolveAppPort("launcher");
    expect(launcherPort).toBe(9222);
  });
});

describe("resolveInstancePort", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("[]", { status: 200 }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return explicit port when provided", async () => {
    const port = await resolveInstancePort(12345);
    expect(port).toBe(12345);
  });

  it("should return explicit port even with non-loopback host", async () => {
    const port = await resolveInstancePort(12345, "192.168.1.100");
    expect(port).toBe(12345);
  });

  it("should throw when non-loopback host and no port", async () => {
    await expect(resolveInstancePort(undefined, "192.168.1.100")).rejects.toThrow(
      "cdpPort is required when using a non-loopback cdpHost",
    );
  });

  it("should throw when remote hostname and no port", async () => {
    await expect(resolveInstancePort(undefined, "my-server.example.com")).rejects.toThrow(
      "cdpPort is required when using a non-loopback cdpHost",
    );
  });

  it("should auto-discover when no host specified", async () => {
    vi.mocked(psList).mockResolvedValue([
      { pid: 1000, name: "linked-helper", ppid: 1 },
      { pid: 2000, name: "linked-helper", ppid: 1000 },
    ]);
    vi.mocked(pidToPorts)
      .mockResolvedValueOnce(new Set([9222]) as never)
      .mockResolvedValueOnce(new Set([55660]) as never);

    const port = await resolveInstancePort();
    expect(port).toBe(55660);
  });

  it("should auto-discover when host is localhost", async () => {
    vi.mocked(psList).mockResolvedValue([
      { pid: 1000, name: "linked-helper", ppid: 1 },
      { pid: 2000, name: "linked-helper", ppid: 1000 },
    ]);
    vi.mocked(pidToPorts)
      .mockResolvedValueOnce(new Set([9222]) as never)
      .mockResolvedValueOnce(new Set([55660]) as never);

    const port = await resolveInstancePort(undefined, "localhost");
    expect(port).toBe(55660);
  });

  it("should auto-discover when host is 127.0.0.1", async () => {
    vi.mocked(psList).mockResolvedValue([
      { pid: 1000, name: "linked-helper", ppid: 1 },
      { pid: 2000, name: "linked-helper", ppid: 1000 },
    ]);
    vi.mocked(pidToPorts)
      .mockResolvedValueOnce(new Set([9222]) as never)
      .mockResolvedValueOnce(new Set([55660]) as never);

    const port = await resolveInstancePort(undefined, "127.0.0.1");
    expect(port).toBe(55660);
  });

  it("should auto-discover when host is IPv6 loopback", async () => {
    vi.mocked(psList).mockResolvedValue([
      { pid: 1000, name: "linked-helper", ppid: 1 },
      { pid: 2000, name: "linked-helper", ppid: 1000 },
    ]);
    vi.mocked(pidToPorts)
      .mockResolvedValueOnce(new Set([9222]) as never)
      .mockResolvedValueOnce(new Set([55660]) as never);

    const port = await resolveInstancePort(undefined, "::1");
    expect(port).toBe(55660);
  });
});

describe("resolveLauncherPort", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("[]", { status: 200 }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return explicit port when provided", async () => {
    const port = await resolveLauncherPort(9222);
    expect(port).toBe(9222);
  });

  it("should throw when non-loopback host and no port", async () => {
    await expect(resolveLauncherPort(undefined, "10.0.0.5")).rejects.toThrow(
      "cdpPort is required when using a non-loopback cdpHost",
    );
  });

  it("should auto-discover when no host specified", async () => {
    vi.mocked(psList).mockResolvedValue([
      { pid: 1000, name: "linked-helper", ppid: 1 },
    ]);
    vi.mocked(pidToPorts).mockResolvedValue(new Set([9222]) as never);

    const port = await resolveLauncherPort();
    expect(port).toBe(9222);
  });
});
