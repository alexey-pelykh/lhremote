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
import { listCollections } from "./list-collections.js";

const MOCK_COLLECTIONS = [
  { id: 10, name: "Prospects", peopleCount: 2, createdAt: "2025-01-15T12:00:00.000Z" },
  { id: 11, name: "Clients", peopleCount: 1, createdAt: "2025-01-15T12:00:00.000Z" },
  { id: 12, name: "Empty List", peopleCount: 0, createdAt: "2025-01-15T12:00:00.000Z" },
];

function setupMocks() {
  vi.mocked(resolveAccount).mockResolvedValue(1);

  vi.mocked(withDatabase).mockImplementation(
    async (_accountId, callback) =>
      callback({ accountId: 1, db: {} } as unknown as DatabaseContext),
  );

  vi.mocked(CollectionListRepository).mockImplementation(function () {
    return {
      listCollections: vi.fn().mockReturnValue(MOCK_COLLECTIONS),
    } as unknown as CollectionListRepository;
  });
}

describe("listCollections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns collections with total count", async () => {
    setupMocks();

    const result = await listCollections({ cdpPort: 9222 });

    expect(result.collections).toHaveLength(3);
    expect(result.total).toBe(3);
    const firstCollection = result.collections[0] as (typeof result.collections)[number];
    expect(firstCollection.name).toBe("Prospects");
  });

  it("passes connection options to resolveAccount", async () => {
    setupMocks();

    await listCollections({
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

    await listCollections({ cdpPort: 9222 });

    expect(resolveAccount).toHaveBeenCalledWith(9222, {});
  });

  it("propagates resolveAccount errors", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("connection refused"));

    await expect(
      listCollections({ cdpPort: 9222 }),
    ).rejects.toThrow("connection refused");
  });

  it("propagates withDatabase errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withDatabase).mockRejectedValue(
      new Error("database not found"),
    );

    await expect(
      listCollections({ cdpPort: 9222 }),
    ).rejects.toThrow("database not found");
  });
});
