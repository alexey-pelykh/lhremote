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
import { createCollection } from "./create-collection.js";

function setupMocks() {
  vi.mocked(resolveAccount).mockResolvedValue(1);

  vi.mocked(withDatabase).mockImplementation(
    async (_accountId, callback) =>
      callback({ accountId: 1, db: {} } as unknown as DatabaseContext),
  );

  vi.mocked(CollectionListRepository).mockImplementation(function () {
    return {
      resolveInternalAccountId: vi.fn().mockReturnValue(99),
      createCollection: vi.fn().mockReturnValue(42),
    } as unknown as CollectionListRepository;
  });
}

describe("createCollection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns created collection with ID and name", async () => {
    setupMocks();

    const result = await createCollection({
      name: "My List",
      cdpPort: 9222,
    });

    expect(result.success).toBe(true);
    expect(result.collectionId).toBe(42);
    expect(result.name).toBe("My List");
  });

  it("passes accountId to repository", async () => {
    setupMocks();

    await createCollection({ name: "Test", cdpPort: 9222 });

    const mockResult = vi.mocked(CollectionListRepository).mock.results[0] as {
      value: InstanceType<typeof CollectionListRepository>;
    };
    expect(mockResult.value.resolveInternalAccountId).toHaveBeenCalledWith(1);
    expect(mockResult.value.createCollection).toHaveBeenCalledWith(99, "Test");
  });

  it("opens database in write mode", async () => {
    setupMocks();

    await createCollection({ name: "Test", cdpPort: 9222 });

    expect(withDatabase).toHaveBeenCalledWith(
      1,
      expect.any(Function),
      { readOnly: false },
    );
  });

  it("passes connection options to resolveAccount", async () => {
    setupMocks();

    await createCollection({
      name: "Test",
      cdpPort: 1234,
      cdpHost: "192.168.1.1",
      allowRemote: true,
    });

    expect(resolveAccount).toHaveBeenCalledWith(1234, {
      host: "192.168.1.1",
      allowRemote: true,
    });
  });

  it("propagates resolveAccount errors", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("connection refused"));

    await expect(
      createCollection({ name: "Test", cdpPort: 9222 }),
    ).rejects.toThrow("connection refused");
  });
});
