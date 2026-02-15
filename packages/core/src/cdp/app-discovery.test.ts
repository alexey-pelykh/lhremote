// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findApp } from "./app-discovery.js";

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
      { pid: 1000, cdpPort: 9222, connectable: true },
    ]);
  });

  it("should discover a linked-helper.exe process on Windows", async () => {
    vi.mocked(psList).mockResolvedValue([
      { pid: 2000, name: "linked-helper.exe", ppid: 1 },
    ]);
    vi.mocked(pidToPorts).mockResolvedValue(new Set([9333]) as never);

    const result = await findApp();
    expect(result).toEqual([
      { pid: 2000, cdpPort: 9333, connectable: true },
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
      { pid: 1000, cdpPort: 9222, connectable: true },
      { pid: 2000, cdpPort: 9333, connectable: true },
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
      { pid: 1000, cdpPort: 9222, connectable: false },
    ]);
  });

  it("should return cdpPort null when pidToPorts throws", async () => {
    vi.mocked(psList).mockResolvedValue([
      { pid: 1000, name: "linked-helper", ppid: 1 },
    ]);
    vi.mocked(pidToPorts).mockRejectedValue(new Error("failed"));

    const result = await findApp();
    expect(result).toEqual([
      { pid: 1000, cdpPort: null, connectable: false },
    ]);
  });

  it("should return cdpPort null when process has no listening ports", async () => {
    vi.mocked(psList).mockResolvedValue([
      { pid: 1000, name: "linked-helper", ppid: 1 },
    ]);
    vi.mocked(pidToPorts).mockResolvedValue(new Set() as never);

    const result = await findApp();
    expect(result).toEqual([
      { pid: 1000, cdpPort: null, connectable: false },
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
      { pid: 1000, cdpPort: 9222, connectable: true },
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
