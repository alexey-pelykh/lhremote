// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@insoftex/lhremote-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@insoftex/lhremote-core")>();
  return {
    ...actual,
    scanRunningInstances: vi.fn(),
    scanOrphans: vi.fn(),
  };
});

import { type OrphanProcess, type RunningInstance, scanOrphans, scanRunningInstances } from "@insoftex/lhremote-core";
import { registerListOrphans } from "./list-orphans.js";
import { createMockServer } from "./testing/mock-server.js";

const mockedScanRunningInstances = vi.mocked(scanRunningInstances);
const mockedScanOrphans = vi.mocked(scanOrphans);

describe("registerListOrphans", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedScanRunningInstances.mockResolvedValue([]);
    mockedScanOrphans.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named list-orphans", () => {
    const { server } = createMockServer();
    registerListOrphans(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "list-orphans",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns friendly message when no orphans detected", async () => {
    const { server, getHandler } = createMockServer();
    registerListOrphans(server);

    const handler = getHandler("list-orphans");
    const result = await handler({});

    expect(result).toEqual({
      content: [{ type: "text", text: "No orphaned processes detected." }],
    });
  });

  it("returns JSON when orphans are found", async () => {
    const { server, getHandler } = createMockServer();
    registerListOrphans(server);

    const orphans: OrphanProcess[] = [
      { pid: 9999, cdpPort: null, accountId: 347559, reason: "non-connectable duplicate" },
    ];
    mockedScanOrphans.mockResolvedValue(orphans);

    const handler = getHandler("list-orphans");
    const result = (await handler({})) as { content: [{ text: string }] };
    expect(JSON.parse(result.content[0].text)).toEqual(orphans);
  });

  it("passes live instances to scanOrphans", async () => {
    const { server, getHandler } = createMockServer();
    registerListOrphans(server);

    const liveInstances: RunningInstance[] = [
      { accountId: 347559, pid: 13004, cdpPort: 54321, connectable: true, helperChildCount: 2, source: "cmdline", confidence: "high" },
    ];
    mockedScanRunningInstances.mockResolvedValue(liveInstances);

    const handler = getHandler("list-orphans");
    await handler({});

    expect(mockedScanOrphans).toHaveBeenCalledWith(liveInstances);
  });

  it("returns error on unexpected failure", async () => {
    const { server, getHandler } = createMockServer();
    registerListOrphans(server);

    mockedScanRunningInstances.mockRejectedValue(new Error("scan failed"));

    const handler = getHandler("list-orphans");
    const result = await handler({});

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "Failed to list orphans: scan failed" }],
    });
  });
});
