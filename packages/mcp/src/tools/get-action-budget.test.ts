// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return { ...actual, getActionBudget: vi.fn() };
});

import { getActionBudget } from "@lhremote/core";
import { registerGetActionBudget } from "./get-action-budget.js";
import { createMockServer } from "./testing/mock-server.js";

const MOCK_BUDGET = {
  entries: [
    {
      limitTypeId: 8,
      limitType: "Invite",
      dailyLimit: 100,
      campaignUsed: 5,
      directUsed: 0,
      totalUsed: 5,
      remaining: 95,
    },
  ],
  asOf: "2026-03-21T12:00:00.000Z",
};

describe("registerGetActionBudget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a tool named get-action-budget", () => {
    const { server } = createMockServer();
    registerGetActionBudget(server);

    expect(server.tool).toHaveBeenCalledOnce();
    expect(server.tool).toHaveBeenCalledWith(
      "get-action-budget",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns budget as JSON on success", async () => {
    const { server, getHandler } = createMockServer();
    registerGetActionBudget(server);
    vi.mocked(getActionBudget).mockResolvedValue(MOCK_BUDGET);

    const handler = getHandler("get-action-budget");
    const result = await handler({ cdpPort: 9222 });

    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify(MOCK_BUDGET, null, 2) }],
    });
  });

  it("returns error on failure", async () => {
    const { server, getHandler } = createMockServer();
    registerGetActionBudget(server);
    vi.mocked(getActionBudget).mockRejectedValue(new Error("db offline"));

    const handler = getHandler("get-action-budget");
    const result = await handler({ cdpPort: 9222 }) as { isError?: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Failed to get action budget");
  });
});
