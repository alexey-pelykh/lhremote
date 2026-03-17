// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    createCollection: vi.fn(),
  };
});

import {
  type CreateCollectionOutput,
  createCollection,
} from "@lhremote/core";

import { handleCreateCollection } from "./create-collection.js";
import { getStdout } from "./testing/mock-helpers.js";

const MOCK_RESULT: CreateCollectionOutput = {
  success: true as const,
  collectionId: 3,
  name: "New Prospects",
};

describe("handleCreateCollection", () => {
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

  it("creates collection and prints confirmation", async () => {
    vi.mocked(createCollection).mockResolvedValue(MOCK_RESULT);

    await handleCreateCollection("New Prospects", {});

    expect(process.exitCode).toBeUndefined();
    expect(getStdout(stdoutSpy)).toContain(
      'Created collection #3 "New Prospects".',
    );
  });

  it("prints JSON with --json", async () => {
    vi.mocked(createCollection).mockResolvedValue(MOCK_RESULT);

    await handleCreateCollection("New Prospects", { json: true });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout(stdoutSpy));
    expect(parsed.success).toBe(true);
    expect(parsed.collectionId).toBe(3);
    expect(parsed.name).toBe("New Prospects");
  });

  it("sets exitCode 1 on error", async () => {
    vi.mocked(createCollection).mockRejectedValue(new Error("connection error"));

    await handleCreateCollection("New Prospects", {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("connection error\n");
  });
});
