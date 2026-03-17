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
import { deleteCollection } from "./delete-collection.js";

function setupMocks(deleted = true) {
  vi.mocked(resolveAccount).mockResolvedValue(1);

  vi.mocked(withDatabase).mockImplementation(
    async (_accountId, callback) =>
      callback({ accountId: 1, db: {} } as unknown as DatabaseContext),
  );

  vi.mocked(CollectionListRepository).mockImplementation(function () {
    return {
      deleteCollection: vi.fn().mockReturnValue(deleted),
    } as unknown as CollectionListRepository;
  });
}

describe("deleteCollection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns success when collection exists", async () => {
    setupMocks(true);

    const result = await deleteCollection({
      collectionId: 10,
      cdpPort: 9222,
    });

    expect(result.success).toBe(true);
    expect(result.collectionId).toBe(10);
    expect(result.deleted).toBe(true);
  });

  it("returns deleted=false when collection does not exist", async () => {
    setupMocks(false);

    const result = await deleteCollection({
      collectionId: 999,
      cdpPort: 9222,
    });

    expect(result.deleted).toBe(false);
  });

  it("opens database in write mode", async () => {
    setupMocks();

    await deleteCollection({ collectionId: 10, cdpPort: 9222 });

    expect(withDatabase).toHaveBeenCalledWith(
      1,
      expect.any(Function),
      { readOnly: false },
    );
  });

  it("propagates resolveAccount errors", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("connection refused"));

    await expect(
      deleteCollection({ collectionId: 10, cdpPort: 9222 }),
    ).rejects.toThrow("connection refused");
  });
});
