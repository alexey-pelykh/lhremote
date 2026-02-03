import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverInstancePort } from "./instance-discovery.js";

vi.mock("pid-port", () => ({
  portToPid: vi.fn(),
  pidToPorts: vi.fn(),
}));

vi.mock("ps-list", () => ({
  default: vi.fn(),
}));

import { pidToPorts, portToPid } from "pid-port";
import psList from "ps-list";

describe("discoverInstancePort", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return null when launcher is not running", async () => {
    vi.mocked(portToPid).mockRejectedValue(
      new Error("Could not find a process that uses port `9222`"),
    );

    const port = await discoverInstancePort(9222);
    expect(port).toBeNull();
  });

  it("should return null when portToPid returns undefined", async () => {
    vi.mocked(portToPid).mockResolvedValue(undefined as never);

    const port = await discoverInstancePort(9222);
    expect(port).toBeNull();
  });

  it("should return null when launcher has no children", async () => {
    vi.mocked(portToPid).mockResolvedValue(12345 as never);
    vi.mocked(psList).mockResolvedValue([
      { pid: 99999, name: "other", ppid: 1 },
    ]);

    const port = await discoverInstancePort(9222);
    expect(port).toBeNull();
  });

  it("should discover instance port from child process", async () => {
    vi.mocked(portToPid).mockResolvedValue(12345 as never);
    vi.mocked(psList).mockResolvedValue([
      { pid: 12346, name: "electron", ppid: 12345 },
      { pid: 99999, name: "other", ppid: 1 },
    ]);
    vi.mocked(pidToPorts).mockResolvedValue(new Set([55123]) as never);

    const port = await discoverInstancePort(9222);
    expect(port).toBe(55123);
  });

  it("should skip ports matching the launcher port", async () => {
    vi.mocked(portToPid).mockResolvedValue(12345 as never);
    vi.mocked(psList).mockResolvedValue([
      { pid: 12346, name: "electron", ppid: 12345 },
    ]);
    vi.mocked(pidToPorts).mockResolvedValue(
      new Set([9222, 55999]) as never,
    );

    const port = await discoverInstancePort(9222);
    expect(port).toBe(55999);
  });

  it("should use default launcher port 9222", async () => {
    vi.mocked(portToPid).mockResolvedValue(12345 as never);
    vi.mocked(psList).mockResolvedValue([
      { pid: 12346, name: "electron", ppid: 12345 },
    ]);
    vi.mocked(pidToPorts).mockResolvedValue(new Set([44444]) as never);

    const port = await discoverInstancePort();
    expect(port).toBe(44444);
    expect(portToPid).toHaveBeenCalledWith({ port: 9222, host: "*" });
  });

  it("should return null when pidToPorts throws", async () => {
    vi.mocked(portToPid).mockResolvedValue(12345 as never);
    vi.mocked(psList).mockResolvedValue([
      { pid: 12346, name: "electron", ppid: 12345 },
    ]);
    vi.mocked(pidToPorts).mockRejectedValue(new Error("failed"));

    const port = await discoverInstancePort(9222);
    expect(port).toBeNull();
  });

  it("should return null when psList throws", async () => {
    vi.mocked(portToPid).mockResolvedValue(12345 as never);
    vi.mocked(psList).mockRejectedValue(new Error("failed"));

    const port = await discoverInstancePort(9222);
    expect(port).toBeNull();
  });
});
