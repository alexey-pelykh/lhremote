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
  CollectionListRepository: vi.fn(),
}));

import type { DatabaseContext } from "../services/instance-context.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withDatabase } from "../services/instance-context.js";
import { CollectionListRepository } from "../db/index.js";
import { addPeopleToCollection } from "./add-people-to-collection.js";

function setupMocks(added = 2) {
  vi.mocked(resolveAccount).mockResolvedValue(1);

  vi.mocked(withDatabase).mockImplementation(
    async (_accountId, callback) =>
      callback({ accountId: 1, db: {} } as unknown as DatabaseContext),
  );

  vi.mocked(CollectionListRepository).mockImplementation(function () {
    return {
      addPeople: vi.fn().mockReturnValue(added),
    } as unknown as CollectionListRepository;
  });
}

describe("addPeopleToCollection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns added count and alreadyInCollection", async () => {
    setupMocks(2);

    const result = await addPeopleToCollection({
      collectionId: 10,
      personIds: [1, 2, 3],
      cdpPort: 9222,
    });

    expect(result.success).toBe(true);
    expect(result.collectionId).toBe(10);
    expect(result.added).toBe(2);
    expect(result.alreadyInCollection).toBe(1);
  });

  it("passes collectionId and personIds to repository", async () => {
    setupMocks();

    await addPeopleToCollection({
      collectionId: 10,
      personIds: [1, 2],
      cdpPort: 9222,
    });

    const mockResult = vi.mocked(CollectionListRepository).mock.results[0] as {
      value: InstanceType<typeof CollectionListRepository>;
    };
    expect(mockResult.value.addPeople).toHaveBeenCalledWith(10, [1, 2]);
  });

  it("opens database in write mode", async () => {
    setupMocks();

    await addPeopleToCollection({
      collectionId: 10,
      personIds: [1],
      cdpPort: 9222,
    });

    expect(withDatabase).toHaveBeenCalledWith(
      1,
      expect.any(Function),
      { readOnly: false },
    );
  });

  it("propagates resolveAccount errors", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("connection refused"));

    await expect(
      addPeopleToCollection({ collectionId: 10, personIds: [1], cdpPort: 9222 }),
    ).rejects.toThrow("connection refused");
  });
});
