// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    deleteCollection: vi.fn(),
  };
});

import {
  type DeleteCollectionOutput,
  deleteCollection,
} from "@lhremote/core";

import { handleDeleteCollection } from "./delete-collection.js";
import { getStdout } from "./testing/mock-helpers.js";

const MOCK_DELETED: DeleteCollectionOutput = {
  success: true as const,
  collectionId: 5,
  deleted: true,
};

const MOCK_NOT_FOUND: DeleteCollectionOutput = {
  success: true as const,
  collectionId: 999,
  deleted: false,
};

describe("handleDeleteCollection", () => {
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

  it("deletes collection and prints confirmation", async () => {
    vi.mocked(deleteCollection).mockResolvedValue(MOCK_DELETED);

    await handleDeleteCollection(5, {});

    expect(process.exitCode).toBeUndefined();
    expect(getStdout(stdoutSpy)).toContain("Deleted collection #5.");
  });

  it("prints not-found message when collection does not exist", async () => {
    vi.mocked(deleteCollection).mockResolvedValue(MOCK_NOT_FOUND);

    await handleDeleteCollection(999, {});

    expect(process.exitCode).toBeUndefined();
    expect(getStdout(stdoutSpy)).toContain("Collection #999 not found.");
  });

  it("prints JSON with --json when deleted", async () => {
    vi.mocked(deleteCollection).mockResolvedValue(MOCK_DELETED);

    await handleDeleteCollection(5, { json: true });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout(stdoutSpy));
    expect(parsed.success).toBe(true);
    expect(parsed.collectionId).toBe(5);
    expect(parsed.deleted).toBe(true);
  });

  it("prints JSON with --json when not found", async () => {
    vi.mocked(deleteCollection).mockResolvedValue(MOCK_NOT_FOUND);

    await handleDeleteCollection(999, { json: true });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout(stdoutSpy));
    expect(parsed.success).toBe(true);
    expect(parsed.deleted).toBe(false);
  });

  it("sets exitCode 1 on error", async () => {
    vi.mocked(deleteCollection).mockRejectedValue(new Error("connection error"));

    await handleDeleteCollection(5, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("connection error\n");
  });
});
