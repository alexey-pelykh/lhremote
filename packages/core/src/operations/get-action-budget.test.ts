// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/account-resolution.js", () => ({
  resolveAccount: vi.fn(),
}));

vi.mock("../services/instance-context.js", () => ({
  withDatabase: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  ActionBudgetRepository: vi.fn(),
}));

import type { DatabaseContext } from "../services/instance-context.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withDatabase } from "../services/instance-context.js";
import { ActionBudgetRepository } from "../db/index.js";
import { getActionBudget } from "./get-action-budget.js";

const MOCK_ENTRIES = [
  {
    limitTypeId: 8,
    limitType: "Invite",
    dailyLimit: 100,
    campaignUsed: 5,
    directUsed: 0,
    totalUsed: 5,
    remaining: 95,
  },
];

function setupMocks() {
  vi.mocked(resolveAccount).mockResolvedValue(1);

  vi.mocked(withDatabase).mockImplementation(
    async (_accountId, callback) =>
      callback({ db: {} } as unknown as DatabaseContext),
  );

  vi.mocked(ActionBudgetRepository).mockImplementation(function () {
    return {
      getActionBudget: vi.fn().mockReturnValue(MOCK_ENTRIES),
      getLimitTypes: vi.fn().mockReturnValue([]),
    } as unknown as ActionBudgetRepository;
  });
}

describe("getActionBudget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns action budget with entries and timestamp", async () => {
    setupMocks();

    const result = await getActionBudget({ cdpPort: 9222 });

    expect(result.entries).toEqual(MOCK_ENTRIES);
    expect(result.asOf).toBeDefined();
    expect(new Date(result.asOf).getTime()).not.toBeNaN();
  });

  it("passes connection options to resolveAccount", async () => {
    setupMocks();

    await getActionBudget({
      cdpPort: 1234,
      cdpHost: "192.168.1.1",
      allowRemote: true,
    });

    expect(resolveAccount).toHaveBeenCalledWith(1234, {
      host: "192.168.1.1",
      allowRemote: true,
    });
  });

  it("omits undefined connection options", async () => {
    setupMocks();

    await getActionBudget({ cdpPort: 9222 });

    expect(resolveAccount).toHaveBeenCalledWith(9222, {});
  });

  it("propagates resolveAccount errors", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("connection refused"));

    await expect(
      getActionBudget({ cdpPort: 9222 }),
    ).rejects.toThrow("connection refused");
  });

  it("propagates withDatabase errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withDatabase).mockRejectedValue(
      new Error("database not found"),
    );

    await expect(
      getActionBudget({ cdpPort: 9222 }),
    ).rejects.toThrow("database not found");
  });
});
