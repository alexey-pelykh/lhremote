// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    AppService: vi.fn(),
  };
});

import { AppService } from "@lhremote/core";

import { registerQuitApp } from "./quit-app.js";
import { createMockServer } from "./testing/mock-server.js";

describe("registerQuitApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named quit-app", () => {
    const { server } = createMockServer();
    registerQuitApp(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "quit-app",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns success on successful quit", async () => {
    const { server, getHandler } = createMockServer();
    registerQuitApp(server);

    vi.mocked(AppService).mockImplementation(function () {
      return { quit: vi.fn().mockResolvedValue(undefined) } as unknown as AppService;
    });

    const handler = getHandler("quit-app");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      content: [{ type: "text", text: "LinkedHelper quit successfully" }],
    });
  });

  it("passes cdpPort to AppService constructor", async () => {
    const { server, getHandler } = createMockServer();
    registerQuitApp(server);

    vi.mocked(AppService).mockImplementation(function () {
      return { quit: vi.fn().mockResolvedValue(undefined) } as unknown as AppService;
    });

    const handler = getHandler("quit-app");
    await handler({ cdpPort: 4567 });

    expect(AppService).toHaveBeenCalledWith(4567);
  });

  it("returns error response on failure", async () => {
    const { server, getHandler } = createMockServer();
    registerQuitApp(server);

    vi.mocked(AppService).mockImplementation(function () {
      return {
        quit: vi.fn().mockRejectedValue(new Error("SIGTERM failed")),
      } as unknown as AppService;
    });

    const handler = getHandler("quit-app");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      isError: true,
      content: [
        { type: "text", text: "Failed to quit LinkedHelper: SIGTERM failed" },
      ],
    });
  });
});
