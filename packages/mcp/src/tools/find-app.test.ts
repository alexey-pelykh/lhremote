// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    findApp: vi.fn(),
  };
});

import { type DiscoveredApp, findApp } from "@lhremote/core";

import { registerFindApp } from "./find-app.js";
import { createMockServer } from "./testing/mock-server.js";

const mockedFindApp = vi.mocked(findApp);

describe("registerFindApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named find-app", () => {
    const { server } = createMockServer();
    registerFindApp(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "find-app",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns apps as JSON when found", async () => {
    const { server, getHandler } = createMockServer();
    registerFindApp(server);

    const apps: DiscoveredApp[] = [
      { pid: 1234, cdpPort: 9222, connectable: true },
    ];
    mockedFindApp.mockResolvedValue(apps);

    const handler = getHandler("find-app");
    const result = (await handler({})) as { content: [{ text: string }] };

    expect(JSON.parse(result.content[0].text)).toEqual(apps);
  });

  it("returns friendly message when no apps found", async () => {
    const { server, getHandler } = createMockServer();
    registerFindApp(server);

    mockedFindApp.mockResolvedValue([]);

    const handler = getHandler("find-app");
    const result = await handler({});

    expect(result).toEqual({
      content: [
        { type: "text", text: "No running LinkedHelper instances found" },
      ],
    });
  });

  it("returns error on unexpected failure", async () => {
    const { server, getHandler } = createMockServer();
    registerFindApp(server);

    mockedFindApp.mockRejectedValue(new Error("scan failed"));

    const handler = getHandler("find-app");
    const result = await handler({});

    expect(result).toEqual({
      isError: true,
      content: [
        { type: "text", text: "Failed to find LinkedHelper: scan failed" },
      ],
    });
  });
});
