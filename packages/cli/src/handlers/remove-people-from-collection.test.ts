// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    removePeopleFromCollection: vi.fn(),
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: vi.fn(),
  };
});

import {
  type RemovePeopleFromCollectionOutput,
  removePeopleFromCollection,
} from "@lhremote/core";
import { readFileSync } from "node:fs";

import { handleRemovePeopleFromCollection } from "./remove-people-from-collection.js";
import { getStdout } from "./testing/mock-helpers.js";

const MOCK_RESULT: RemovePeopleFromCollectionOutput = {
  success: true as const,
  collectionId: 1,
  removed: 2,
};

describe("handleRemovePeopleFromCollection", () => {
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

  it("removes people with --person-ids and prints result", async () => {
    vi.mocked(removePeopleFromCollection).mockResolvedValue(MOCK_RESULT);

    await handleRemovePeopleFromCollection(1, { personIds: "100,200" });

    expect(process.exitCode).toBeUndefined();
    expect(getStdout(stdoutSpy)).toContain(
      "Removed 2 people from collection #1.",
    );
  });

  it("reads from --person-ids-file", async () => {
    vi.mocked(readFileSync).mockReturnValue("100\n200\n300");
    vi.mocked(removePeopleFromCollection).mockResolvedValue({
      ...MOCK_RESULT,
      removed: 3,
    });

    await handleRemovePeopleFromCollection(1, { personIdsFile: "ids.txt" });

    expect(process.exitCode).toBeUndefined();
    expect(getStdout(stdoutSpy)).toContain("Removed 3 people");
  });

  it("prints JSON with --json", async () => {
    vi.mocked(removePeopleFromCollection).mockResolvedValue(MOCK_RESULT);

    await handleRemovePeopleFromCollection(1, { personIds: "100,200", json: true });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout(stdoutSpy));
    expect(parsed.success).toBe(true);
    expect(parsed.collectionId).toBe(1);
    expect(parsed.removed).toBe(2);
  });

  it("sets exitCode 1 when both person-ids options provided", async () => {
    await handleRemovePeopleFromCollection(1, {
      personIds: "100",
      personIdsFile: "ids.txt",
    });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Use only one of --person-ids or --person-ids-file.\n",
    );
  });

  it("sets exitCode 1 when no person-ids option provided", async () => {
    await handleRemovePeopleFromCollection(1, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Either --person-ids or --person-ids-file is required.\n",
    );
  });

  it("sets exitCode 1 when person IDs are empty", async () => {
    vi.mocked(readFileSync).mockReturnValue("");

    await handleRemovePeopleFromCollection(1, { personIdsFile: "empty.txt" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("No valid person IDs provided.\n");
  });

  it("sets exitCode 1 on error", async () => {
    vi.mocked(removePeopleFromCollection).mockRejectedValue(new Error("timeout"));

    await handleRemovePeopleFromCollection(1, { personIds: "100" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("timeout\n");
  });

  it("sets exitCode 1 when person-ids-file read fails", async () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error("ENOENT: no such file");
    });

    await handleRemovePeopleFromCollection(1, { personIdsFile: "missing.txt" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("ENOENT"),
    );
  });
});
