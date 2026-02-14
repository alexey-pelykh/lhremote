// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { describe, expect, it } from "vitest";

import * as toolExports from "./index.js";
import { registerAllTools } from "./index.js";
import { createMockServer } from "./testing/mock-server.js";

describe("registerAllTools", () => {
  it("calls every exported register* function", () => {
    const registerExports = Object.keys(toolExports).filter(
      (key) => key.startsWith("register") && key !== "registerAllTools",
    );

    const { server } = createMockServer();
    registerAllTools(server);

    expect(server.tool).toHaveBeenCalledTimes(registerExports.length);
  });

  it("registers tools with unique names", () => {
    const { server } = createMockServer();
    registerAllTools(server);

    const toolNames = (server.tool as ReturnType<typeof import("vitest").vi.fn>).mock.calls.map(
      (call: unknown[]) => call[0],
    );
    const uniqueNames = new Set(toolNames);
    expect(uniqueNames.size).toBe(toolNames.length);
  });
});
