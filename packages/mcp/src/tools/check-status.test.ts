// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    checkStatus: vi.fn(),
  };
});

import { type StatusReport, checkStatus } from "@lhremote/core";

import { registerCheckStatus } from "./check-status.js";
import { createMockServer } from "./testing/mock-server.js";

const mockedCheckStatus = vi.mocked(checkStatus);

describe("registerCheckStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named check-status", () => {
    const { server } = createMockServer();
    registerCheckStatus(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "check-status",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns status report as JSON", async () => {
    const { server, getHandler } = createMockServer();
    registerCheckStatus(server);

    const report: StatusReport = {
      launcher: { reachable: true, port: 9222 },
      instances: [
        { accountId: 1, accountName: "Alice", cdpPort: 54321 },
      ],
      databases: [
        { accountId: 1, path: "/path/to/db.db", profileCount: 100 },
      ],
    };

    mockedCheckStatus.mockResolvedValue(report);

    const handler = getHandler("check-status");
    const result = (await handler({ cdpPort: 9222 })) as {
      content: [{ text: string }];
    };

    expect(JSON.parse(result.content[0].text)).toEqual(report);
  });

  it("returns status when launcher is not reachable", async () => {
    const { server, getHandler } = createMockServer();
    registerCheckStatus(server);

    const report: StatusReport = {
      launcher: { reachable: false, port: 9222 },
      instances: [],
      databases: [],
    };

    mockedCheckStatus.mockResolvedValue(report);

    const handler = getHandler("check-status");
    const result = (await handler({ cdpPort: 9222 })) as {
      content: [{ text: string }];
    };

    const parsed = JSON.parse(result.content[0].text) as StatusReport;
    expect(parsed.launcher.reachable).toBe(false);
  });

  it("passes cdpPort to checkStatus", async () => {
    const { server, getHandler } = createMockServer();
    registerCheckStatus(server);

    mockedCheckStatus.mockResolvedValue({
      launcher: { reachable: false, port: 4567 },
      instances: [],
      databases: [],
    });

    const handler = getHandler("check-status");
    await handler({ cdpPort: 4567 });

    expect(mockedCheckStatus).toHaveBeenCalledWith(4567, {});
  });

  it("returns error when checkStatus throws", async () => {
    const { server, getHandler } = createMockServer();
    registerCheckStatus(server);

    mockedCheckStatus.mockRejectedValue(new Error("unexpected failure"));

    const handler = getHandler("check-status");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to check status: unexpected failure",
        },
      ],
    });
  });
});
