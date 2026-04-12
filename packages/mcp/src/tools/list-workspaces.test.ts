// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    LauncherService: vi.fn(),
  };
});

import {
  LauncherService,
  LinkedHelperNotRunningError,
  type Workspace,
} from "@lhremote/core";

import { registerListWorkspaces } from "./list-workspaces.js";
import { createMockServer } from "./testing/mock-server.js";

function mockLauncher(overrides: Partial<LauncherService> = {}) {
  const disconnect = vi.fn();
  vi.mocked(LauncherService).mockImplementation(function () {
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect,
      listWorkspaces: vi.fn().mockResolvedValue([]),
      ...overrides,
    } as unknown as LauncherService;
  });
  return { disconnect };
}

const SAMPLE_WORKSPACES: Workspace[] = [
  {
    id: 20338,
    name: "PELYKH Consulting",
    deleted: false,
    workspaceUser: {
      id: 33440,
      userId: 438509,
      workspaceId: 20338,
      role: "owner",
      deleted: false,
    },
    selected: true,
  },
];

describe("registerListWorkspaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named list-workspaces", () => {
    const { server } = createMockServer();
    registerListWorkspaces(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "list-workspaces",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns workspaces as JSON", async () => {
    const { server, getHandler } = createMockServer();
    registerListWorkspaces(server);

    mockLauncher({
      listWorkspaces: vi.fn().mockResolvedValue(SAMPLE_WORKSPACES),
    });

    const handler = getHandler("list-workspaces");
    const result = (await handler({ cdpPort: 9222 })) as {
      content: [{ text: string }];
    };

    expect(JSON.parse(result.content[0].text)).toEqual(SAMPLE_WORKSPACES);
  });

  it("returns empty array when no workspaces", async () => {
    const { server, getHandler } = createMockServer();
    registerListWorkspaces(server);

    mockLauncher({ listWorkspaces: vi.fn().mockResolvedValue([]) });

    const handler = getHandler("list-workspaces");
    const result = (await handler({ cdpPort: 9222 })) as {
      content: [{ text: string }];
    };

    expect(JSON.parse(result.content[0].text)).toEqual([]);
  });

  it("returns error when LinkedHelper not running", async () => {
    const { server, getHandler } = createMockServer();
    registerListWorkspaces(server);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi
          .fn()
          .mockRejectedValue(new LinkedHelperNotRunningError(9222)),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });

    const handler = getHandler("list-workspaces");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "LinkedHelper is not running. Use launch-app first.",
        },
      ],
    });
  });

  it("disconnects after successful call", async () => {
    const { server, getHandler } = createMockServer();
    registerListWorkspaces(server);

    const { disconnect } = mockLauncher();

    const handler = getHandler("list-workspaces");
    await handler({ cdpPort: 9222 });

    expect(disconnect).toHaveBeenCalledOnce();
  });
});
