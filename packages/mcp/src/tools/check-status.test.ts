// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@insoftex/lhremote-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@insoftex/lhremote-core")>();
  return {
    ...actual,
    checkStatus: vi.fn(),
  };
});

import { type InstanceReadinessEntry, type StatusReport, checkStatus } from "@insoftex/lhremote-core";

import { registerCheckStatus } from "./check-status.js";
import { createMockServer } from "./testing/mock-server.js";

const mockedCheckStatus = vi.mocked(checkStatus);

function makeRunningInstance(overrides: Partial<InstanceReadinessEntry> = {}): InstanceReadinessEntry {
  return {
    accountId: 1,
    name: "Alice",
    email: "alice@example.com",
    pid: 12345,
    cdpPort: 54321,
    connectable: true,
    helperChildCount: 0,
    source: "cmdline",
    confidence: "high",
    readiness: "connectable",
    ...overrides,
  };
}

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
      instances: [makeRunningInstance()],
      runningInstances: [makeRunningInstance()],
      databases: [{ accountId: 1, path: "/path/to/db.db", profileCount: 100 }],
    };

    mockedCheckStatus.mockResolvedValue(report);

    const handler = getHandler("check-status");
    const result = (await handler({ cdpPort: 9222 })) as {
      content: [{ text: string }];
    };

    expect(JSON.parse(result.content[0].text)).toEqual(report);
  });

  it("instances[] contains exactly 3 running entries (not 7 from launcher roster)", async () => {
    const { server, getHandler } = createMockServer();
    registerCheckStatus(server);

    const runningInstances: InstanceReadinessEntry[] = [
      makeRunningInstance({ accountId: 347559, name: "Vira Lyn", cdpPort: 50297, pid: 13004 }),
      makeRunningInstance({ accountId: 329925, name: "Mike Florko", cdpPort: 56429, pid: 13640 }),
      makeRunningInstance({ accountId: 331874, name: "Michael Fliorko", cdpPort: 49530, pid: 7044 }),
    ];

    mockedCheckStatus.mockResolvedValue({
      launcher: { reachable: false, port: null },
      instances: runningInstances,
      runningInstances,
      databases: [],
    });

    const handler = getHandler("check-status");
    const result = (await handler({})) as { content: [{ text: string }] };
    const parsed = JSON.parse(result.content[0].text) as StatusReport;

    // 3 running instances — never 7 configured accounts
    expect(parsed.instances).toHaveLength(3);
    const accountIds = parsed.instances.map((i) => i.accountId).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(accountIds).toEqual([329925, 331874, 347559]);
  });

  it("instances[] entries have real cdpPort and connectable from process inspection", async () => {
    const { server, getHandler } = createMockServer();
    registerCheckStatus(server);

    mockedCheckStatus.mockResolvedValue({
      launcher: { reachable: false, port: null },
      instances: [
        makeRunningInstance({ accountId: 347559, cdpPort: 50297, connectable: true }),
        makeRunningInstance({ accountId: 329925, cdpPort: 56429, connectable: true }),
      ],
      runningInstances: [
        makeRunningInstance({ accountId: 347559, cdpPort: 50297, connectable: true }),
        makeRunningInstance({ accountId: 329925, cdpPort: 56429, connectable: true }),
      ],
      databases: [],
    });

    const handler = getHandler("check-status");
    const result = (await handler({})) as { content: [{ text: string }] };
    const parsed = JSON.parse(result.content[0].text) as StatusReport;

    for (const instance of parsed.instances) {
      expect(instance.cdpPort).not.toBeNull();
      expect(instance.connectable).toBe(true);
    }
  });

  it("instances[] never contains credentials or proxy info", async () => {
    const { server, getHandler } = createMockServer();
    registerCheckStatus(server);

    mockedCheckStatus.mockResolvedValue({
      launcher: { reachable: false, port: null },
      instances: [makeRunningInstance({ accountId: 347559, name: "Vira Lyn" })],
      runningInstances: [makeRunningInstance({ accountId: 347559, name: "Vira Lyn" })],
      databases: [],
    });

    const handler = getHandler("check-status");
    const result = (await handler({})) as { content: [{ text: string }] };
    const text = result.content[0].text;

    expect(text).not.toContain("app-credentials");
    expect(text).not.toContain("socks5://");
    expect(text).not.toContain("upstream-proxy");
    expect(text).not.toContain("sentry.io");
  });

  it("returns status when launcher is not reachable", async () => {
    const { server, getHandler } = createMockServer();
    registerCheckStatus(server);

    const report: StatusReport = {
      launcher: { reachable: false, port: 9222 },
      instances: [],
      runningInstances: [],
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
      runningInstances: [],
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

  it("forwards accountId via buildCdpOptions when supplied (regression #793)", async () => {
    const { server, getHandler } = createMockServer();
    registerCheckStatus(server);

    mockedCheckStatus.mockResolvedValue({
      launcher: { reachable: false, port: 9222 },
      instances: [],
      runningInstances: [],
      databases: [],
    });

    const handler = getHandler("check-status");
    await handler({ cdpPort: 9222, accountId: 12345 });

    expect(mockedCheckStatus).toHaveBeenCalledWith(
      9222,
      expect.objectContaining({ accountId: 12345 }),
    );
  });
});
