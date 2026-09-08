// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./account-resolution.js", () => ({
  resolveAccount: vi.fn(),
}));

vi.mock("./instance-context.js", () => ({
  withDatabase: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  ActionBudgetRepository: vi.fn(),
}));

import { ActionBudgetRepository } from "../db/index.js";
import type { ActionBudgetEntry } from "../types/action-budget.js";
import { resolveAccount } from "./account-resolution.js";
import { assertActionBudget } from "./action-budget-guard.js";
import { BudgetExceededError } from "./errors.js";
import type { DatabaseContext } from "./instance-context.js";
import { withDatabase } from "./instance-context.js";

const POST_LIKE = 18;

/** A budget entry with every field defaulted to "plenty of headroom". */
function entry(over: Partial<ActionBudgetEntry> = {}): ActionBudgetEntry {
  return {
    limitTypeId: POST_LIKE,
    limitType: "PostLike",
    dailyLimit: 100,
    campaignUsed: 1,
    directUsed: 0,
    totalUsed: 1,
    remaining: 99,
    ...over,
  };
}

/** Wire the three collaborators so the guard reads `entries` and nothing else. */
function setupMocks(entries: ActionBudgetEntry[]) {
  const getActionBudget = vi.fn().mockReturnValue(entries);

  vi.mocked(resolveAccount).mockResolvedValue(7);
  vi.mocked(withDatabase).mockImplementation(
    async (_accountId, callback) =>
      callback({ db: {} } as unknown as DatabaseContext),
  );
  vi.mocked(ActionBudgetRepository).mockImplementation(function () {
    return {
      getActionBudget,
      getLimitTypes: vi.fn().mockReturnValue([]),
    } as unknown as ActionBudgetRepository;
  });

  return { getActionBudget };
}

describe("assertActionBudget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("refuses", () => {
    it("throws BudgetExceededError when the limit type has no headroom", async () => {
      setupMocks([
        entry({ dailyLimit: 10, campaignUsed: 10, totalUsed: 10, remaining: 0 }),
      ]);

      await expect(assertActionBudget(POST_LIKE, 9222, {})).rejects.toThrow(
        BudgetExceededError,
      );
    });

    it("reports the exhausted limit type, its limit, and its usage", async () => {
      setupMocks([
        entry({ dailyLimit: 10, campaignUsed: 12, totalUsed: 12, remaining: 0 }),
      ]);

      // The three fields are asserted individually rather than via the message
      // alone: a caller (the CLI's error surface) reads them off the error.
      const error = await assertActionBudget(POST_LIKE, 9222, {}).catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(BudgetExceededError);
      expect(error).toMatchObject({
        limitType: "PostLike",
        dailyLimit: 10,
        totalUsed: 12,
      });
    });

    it("substitutes 0 for a null daily limit it is reporting on", async () => {
      // Unreachable through the ordinary path — a null `dailyLimit` yields a
      // null `remaining`, which proceeds. Pinned because the `?? 0` fallback is
      // otherwise dead-looking code a later reader could delete.
      setupMocks([
        entry({ dailyLimit: null, totalUsed: 3, remaining: 0 }),
      ]);

      const error = await assertActionBudget(POST_LIKE, 9222, {}).catch(
        (e: unknown) => e,
      );

      expect(error).toMatchObject({ dailyLimit: 0, totalUsed: 3 });
    });

    it("refuses on a negative remaining, not only on exactly zero", async () => {
      setupMocks([
        entry({ dailyLimit: 10, totalUsed: 14, remaining: -4 }),
      ]);

      await expect(assertActionBudget(POST_LIKE, 9222, {})).rejects.toThrow(
        BudgetExceededError,
      );
    });
  });

  describe("proceeds", () => {
    it("resolves when the limit type has headroom left", async () => {
      setupMocks([entry()]);

      await expect(
        assertActionBudget(POST_LIKE, 9222, {}),
      ).resolves.toBeUndefined();
    });

    it("resolves when the limit type has no daily limit configured", async () => {
      setupMocks([
        entry({ dailyLimit: null, campaignUsed: 0, totalUsed: 0, remaining: null }),
      ]);

      await expect(
        assertActionBudget(POST_LIKE, 9222, {}),
      ).resolves.toBeUndefined();
    });

    it("resolves when this limit type is absent from the budget entirely", async () => {
      // An absent row is the database declining to speak, not a zero budget.
      setupMocks([
        entry({ limitTypeId: 8, limitType: "Invite", remaining: 0, totalUsed: 100, dailyLimit: 100 }),
      ]);

      await expect(
        assertActionBudget(POST_LIKE, 9222, {}),
      ).resolves.toBeUndefined();
    });

    it("resolves when the budget is empty", async () => {
      setupMocks([]);

      await expect(
        assertActionBudget(POST_LIKE, 9222, {}),
      ).resolves.toBeUndefined();
    });

    it("consults only the limit type it was asked about", async () => {
      // Two exhausted siblings either side of a healthy subject: a guard that
      // scanned for "any exhausted entry" instead of finding this one would
      // pass every other test in this file and fail here.
      setupMocks([
        entry({ limitTypeId: 8, limitType: "Invite", remaining: 0, totalUsed: 100 }),
        entry(),
        entry({ limitTypeId: 19, limitType: "PostComment", remaining: 0, totalUsed: 10 }),
      ]);

      await expect(
        assertActionBudget(POST_LIKE, 9222, {}),
      ).resolves.toBeUndefined();
    });
  });

  describe("account resolution", () => {
    it("forwards the port and connection options to resolveAccount", async () => {
      setupMocks([entry()]);

      await assertActionBudget(POST_LIKE, 9333, {
        host: "192.168.1.100",
        allowRemote: true,
      });

      expect(resolveAccount).toHaveBeenCalledWith(9333, {
        host: "192.168.1.100",
        allowRemote: true,
      });
    });

    it("opens the database for the account resolveAccount returned", async () => {
      setupMocks([entry()]);

      await assertActionBudget(POST_LIKE, 9222, { accountId: 7 });

      expect(withDatabase).toHaveBeenCalledWith(7, expect.any(Function));
    });

    it("reads the budget without supplying directCounts", async () => {
      // Nothing in this repository records CDP-direct actions, so there is no
      // count to supply and the campaign-only reading is the honest one. This
      // pins that as a decision rather than an omission: whoever lands the
      // debit half of #569 will have a source, and this assertion is what they
      // should have to change deliberately.
      const { getActionBudget } = setupMocks([entry()]);

      await assertActionBudget(POST_LIKE, 9222, {});

      expect(getActionBudget).toHaveBeenCalledWith();
    });

    it("propagates a resolveAccount failure without reading the budget", async () => {
      const { getActionBudget } = setupMocks([entry()]);
      vi.mocked(resolveAccount).mockRejectedValue(new Error("no accounts"));

      await expect(assertActionBudget(POST_LIKE, 9222, {})).rejects.toThrow(
        "no accounts",
      );
      expect(getActionBudget).not.toHaveBeenCalled();
    });
  });
});
