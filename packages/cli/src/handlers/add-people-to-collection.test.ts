// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    addPeopleToCollection: vi.fn(),
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
  type AddPeopleToCollectionOutput,
  addPeopleToCollection,
} from "@lhremote/core";
import { readFileSync } from "node:fs";

import { handleAddPeopleToCollection } from "./add-people-to-collection.js";
import { getStdout } from "./testing/mock-helpers.js";

function mockResult(added: number, alreadyInCollection = 0): AddPeopleToCollectionOutput {
  return {
    success: true as const,
    collectionId: 1,
    added,
    alreadyInCollection,
  };
}

describe("handleAddPeopleToCollection", () => {
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

  it("adds people with --person-ids and prints result", async () => {
    vi.mocked(addPeopleToCollection).mockResolvedValue(mockResult(2));

    await handleAddPeopleToCollection(1, { personIds: "100,200" });

    expect(process.exitCode).toBeUndefined();
    expect(getStdout(stdoutSpy)).toContain(
      "Added 2 people to collection #1.",
    );
  });

  it("reports alreadyInCollection count", async () => {
    vi.mocked(addPeopleToCollection).mockResolvedValue(mockResult(1, 1));

    await handleAddPeopleToCollection(1, { personIds: "100,200" });

    const output = getStdout(stdoutSpy);
    expect(output).toContain("Added 1 people");
    expect(output).toContain("1 already in collection.");
  });

  it("reads from --person-ids-file", async () => {
    vi.mocked(readFileSync).mockReturnValue("100\n200\n300");
    vi.mocked(addPeopleToCollection).mockResolvedValue(mockResult(3));

    await handleAddPeopleToCollection(1, { personIdsFile: "ids.txt" });

    expect(process.exitCode).toBeUndefined();
  });

  it("prints JSON with --json", async () => {
    vi.mocked(addPeopleToCollection).mockResolvedValue(mockResult(2));

    await handleAddPeopleToCollection(1, { personIds: "100,200", json: true });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout(stdoutSpy));
    expect(parsed.success).toBe(true);
    expect(parsed.collectionId).toBe(1);
    expect(parsed.added).toBe(2);
    expect(parsed.alreadyInCollection).toBe(0);
  });

  it("sets exitCode 1 when both person-ids options provided", async () => {
    await handleAddPeopleToCollection(1, {
      personIds: "100",
      personIdsFile: "ids.txt",
    });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Use only one of --person-ids or --person-ids-file.\n",
    );
  });

  it("sets exitCode 1 when no person-ids option provided", async () => {
    await handleAddPeopleToCollection(1, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Either --person-ids or --person-ids-file is required.\n",
    );
  });

  it("sets exitCode 1 when person IDs are empty", async () => {
    vi.mocked(readFileSync).mockReturnValue("");

    await handleAddPeopleToCollection(1, { personIdsFile: "empty.txt" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("No valid person IDs provided.\n");
  });

  it("sets exitCode 1 on error", async () => {
    vi.mocked(addPeopleToCollection).mockRejectedValue(new Error("timeout"));

    await handleAddPeopleToCollection(1, { personIds: "100" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("timeout\n");
  });

  it("sets exitCode 1 when person-ids-file read fails", async () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error("ENOENT: no such file");
    });

    await handleAddPeopleToCollection(1, { personIdsFile: "missing.txt" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("ENOENT"),
    );
  });
});
