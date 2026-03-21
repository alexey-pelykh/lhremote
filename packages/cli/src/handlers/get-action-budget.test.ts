// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return { ...actual, getActionBudget: vi.fn() };
});

import { getActionBudget } from "@lhremote/core";
import { handleGetActionBudget } from "./get-action-budget.js";

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

describe("handleGetActionBudget", () => {
  let stdoutChunks: string[];
  let stderrChunks: string[];
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutChunks = [];
    stderrChunks = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdoutChunks.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderrChunks.push(String(chunk));
      return true;
    });
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = originalExitCode;
  });

  it("outputs JSON when --json flag is set", async () => {
    vi.mocked(getActionBudget).mockResolvedValue(MOCK_BUDGET);

    await handleGetActionBudget({ json: true });

    const output = JSON.parse(stdoutChunks.join(""));
    expect(output).toEqual(MOCK_BUDGET);
    expect(process.exitCode).toBeUndefined();
  });

  it("outputs human-readable text by default", async () => {
    vi.mocked(getActionBudget).mockResolvedValue(MOCK_BUDGET);

    await handleGetActionBudget({});

    const output = stdoutChunks.join("");
    expect(output).toContain("Action Budget");
    expect(output).toContain("Invite");
    expect(output).toContain("5/100 used");
    expect(output).toContain("95 remaining");
  });

  it("sets exit code 1 on error", async () => {
    vi.mocked(getActionBudget).mockRejectedValue(new Error("db offline"));

    await handleGetActionBudget({});

    expect(process.exitCode).toBe(1);
    expect(stderrChunks.join("")).toContain("db offline");
  });
});
