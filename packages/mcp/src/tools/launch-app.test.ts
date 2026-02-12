// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    AppService: vi.fn(),
  };
});

import { AppLaunchError, AppNotFoundError, AppService } from "@lhremote/core";

import { registerLaunchApp } from "./launch-app.js";
import { createMockServer } from "./testing/mock-server.js";

describe("registerLaunchApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named launch-app", () => {
    const { server } = createMockServer();
    registerLaunchApp(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "launch-app",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns success with port on successful launch", async () => {
    const { server, getHandler } = createMockServer();
    registerLaunchApp(server);

    const mockLaunch = vi.fn().mockResolvedValue(undefined);
    vi.mocked(AppService).mockImplementation(function () {
      return { launch: mockLaunch, cdpPort: 9222 } as unknown as AppService;
    });

    const handler = getHandler("launch-app");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      content: [{ type: "text", text: "LinkedHelper launched on CDP port 9222" }],
    });
  });

  it("passes cdpPort to AppService constructor", async () => {
    const { server, getHandler } = createMockServer();
    registerLaunchApp(server);

    const mockLaunch = vi.fn().mockResolvedValue(undefined);
    vi.mocked(AppService).mockImplementation(function () {
      return { launch: mockLaunch, cdpPort: 4567 } as unknown as AppService;
    });

    const handler = getHandler("launch-app");
    await handler({ cdpPort: 4567 });

    expect(AppService).toHaveBeenCalledWith(4567);
  });

  it("returns error response on AppNotFoundError", async () => {
    const { server, getHandler } = createMockServer();
    registerLaunchApp(server);

    vi.mocked(AppService).mockImplementation(function () {
      return {
        launch: vi.fn().mockRejectedValue(
          new AppNotFoundError("Binary not found at /foo"),
        ),
      } as unknown as AppService;
    });

    const handler = getHandler("launch-app");
    const result = await handler({});

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "Binary not found at /foo" }],
    });
  });

  it("returns error response on AppLaunchError", async () => {
    const { server, getHandler } = createMockServer();
    registerLaunchApp(server);

    vi.mocked(AppService).mockImplementation(function () {
      return {
        launch: vi.fn().mockRejectedValue(
          new AppLaunchError("Failed to launch LinkedHelper: spawn EACCES"),
        ),
      } as unknown as AppService;
    });

    const handler = getHandler("launch-app");
    const result = await handler({});

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Failed to launch LinkedHelper: spawn EACCES",
        },
      ],
    });
  });

  it("returns error response on unexpected error", async () => {
    const { server, getHandler } = createMockServer();
    registerLaunchApp(server);

    vi.mocked(AppService).mockImplementation(function () {
      return {
        launch: vi.fn().mockRejectedValue(new Error("spawn ENOENT")),
      } as unknown as AppService;
    });

    const handler = getHandler("launch-app");
    const result = await handler({});

    expect(result).toEqual({
      isError: true,
      content: [
        { type: "text", text: "Failed to launch LinkedHelper: spawn ENOENT" },
      ],
    });
  });
});
