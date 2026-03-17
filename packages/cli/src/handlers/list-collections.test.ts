// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    DatabaseClient: vi.fn(),
    CollectionListRepository: vi.fn(),
    discoverAllDatabases: vi.fn(),
  };
});

import { type CollectionSummary, CollectionListRepository } from "@lhremote/core";

import { handleListCollections } from "./list-collections.js";
import { getStdout, mockDb, mockDiscovery } from "./testing/mock-helpers.js";

const MOCK_COLLECTIONS: CollectionSummary[] = [
  {
    id: 1,
    name: "Prospects Q1",
    peopleCount: 42,
    createdAt: "2025-01-01T00:00:00Z",
  },
  {
    id: 2,
    name: "Follow-Up List",
    peopleCount: 7,
    createdAt: "2025-01-02T00:00:00Z",
  },
];

function mockRepo(collections: CollectionSummary[] = MOCK_COLLECTIONS) {
  vi.mocked(CollectionListRepository).mockImplementation(function () {
    return {
      listCollections: vi.fn().mockReturnValue(collections),
    } as unknown as CollectionListRepository;
  });
}

function setupSuccessPath() {
  mockDiscovery();
  mockDb();
  mockRepo();
}

describe("handleListCollections", () => {
  const originalExitCode = process.exitCode;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.exitCode = undefined;
    vi.clearAllMocks();
    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("prints JSON with --json", async () => {
    setupSuccessPath();

    await handleListCollections({ json: true });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout(stdoutSpy));
    expect(parsed.collections).toHaveLength(2);
    expect(parsed.total).toBe(2);
  });

  it("prints human-readable output", async () => {
    setupSuccessPath();

    await handleListCollections({});

    expect(process.exitCode).toBeUndefined();
    const output = getStdout(stdoutSpy);
    expect(output).toContain("Collections (2 total):");
    expect(output).toContain("#1  Prospects Q1");
    expect(output).toContain("42 people");
    expect(output).toContain("#2  Follow-Up List");
    expect(output).toContain("7 people");
  });

  it("prints 'No collections found' when empty", async () => {
    mockDiscovery();
    mockDb();
    mockRepo([]);

    await handleListCollections({});

    expect(process.exitCode).toBeUndefined();
    expect(getStdout(stdoutSpy)).toContain("No collections found.");
  });

  it("sets exitCode 1 when no databases found", async () => {
    mockDiscovery(new Map());

    await handleListCollections({});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "No LinkedHelper databases found.\n",
    );
  });

  it("closes database after listing", async () => {
    mockDiscovery();
    const { close } = mockDb();
    mockRepo();

    await handleListCollections({});

    expect(close).toHaveBeenCalledOnce();
  });

  it("sets exitCode 1 on database error", async () => {
    mockDiscovery();
    mockDb();
    vi.mocked(CollectionListRepository).mockImplementation(function () {
      return {
        listCollections: vi.fn().mockImplementation(() => {
          throw new Error("database locked");
        }),
      } as unknown as CollectionListRepository;
    });

    await handleListCollections({});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("database locked"),
    );
  });
});
