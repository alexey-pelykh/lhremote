// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    importPeopleFromCollection: vi.fn(),
  };
});

import {
  type ImportPeopleFromCollectionOutput,
  CampaignExecutionError,
  CampaignNotFoundError,
  InstanceNotRunningError,
  importPeopleFromCollection,
} from "@lhremote/core";

import { handleImportPeopleFromCollection } from "./import-people-from-collection.js";
import { getStdout } from "./testing/mock-helpers.js";

const MOCK_RESULT: ImportPeopleFromCollectionOutput = {
  success: true as const,
  collectionId: 10,
  campaignId: 1,
  actionId: 5,
  totalUrls: 3,
  imported: 3,
  alreadyInQueue: 1,
  alreadyProcessed: 0,
  failed: 0,
};

describe("handleImportPeopleFromCollection", () => {
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

  it("imports people and prints result", async () => {
    vi.mocked(importPeopleFromCollection).mockResolvedValue(MOCK_RESULT);

    await handleImportPeopleFromCollection(10, 1, {});

    expect(process.exitCode).toBeUndefined();
    const output = getStdout(stdoutSpy);
    expect(output).toContain(
      "Imported 3 people from collection #10 into campaign 1 action 5.",
    );
    expect(output).toContain("1 already in queue.");
  });

  it("prints JSON with --json", async () => {
    vi.mocked(importPeopleFromCollection).mockResolvedValue(MOCK_RESULT);

    await handleImportPeopleFromCollection(10, 1, { json: true });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout(stdoutSpy));
    expect(parsed.success).toBe(true);
    expect(parsed.collectionId).toBe(10);
    expect(parsed.campaignId).toBe(1);
    expect(parsed.actionId).toBe(5);
    expect(parsed.imported).toBe(3);
    expect(parsed.alreadyInQueue).toBe(1);
  });

  it("prints empty-collection message when totalUrls is 0", async () => {
    vi.mocked(importPeopleFromCollection).mockResolvedValue({
      ...MOCK_RESULT,
      totalUrls: 0,
      imported: 0,
      alreadyInQueue: 0,
    });

    await handleImportPeopleFromCollection(10, 1, {});

    expect(process.exitCode).toBeUndefined();
    expect(getStdout(stdoutSpy)).toContain(
      "Collection #10 has no people with LinkedIn profiles.",
    );
  });

  it("shows already-processed and failed counts when non-zero", async () => {
    vi.mocked(importPeopleFromCollection).mockResolvedValue({
      ...MOCK_RESULT,
      imported: 1,
      alreadyInQueue: 0,
      alreadyProcessed: 2,
      failed: 1,
    });

    await handleImportPeopleFromCollection(10, 1, {});

    const output = getStdout(stdoutSpy);
    expect(output).toContain("2 already processed.");
    expect(output).toContain("1 failed.");
  });

  it("omits zero counts from human output", async () => {
    vi.mocked(importPeopleFromCollection).mockResolvedValue({
      ...MOCK_RESULT,
      alreadyInQueue: 0,
      alreadyProcessed: 0,
      failed: 0,
    });

    await handleImportPeopleFromCollection(10, 1, {});

    const output = getStdout(stdoutSpy);
    expect(output).not.toContain("already in queue");
    expect(output).not.toContain("already processed");
    expect(output).not.toContain("failed");
  });

  it("sets exitCode 1 when campaign not found", async () => {
    vi.mocked(importPeopleFromCollection).mockRejectedValue(
      new CampaignNotFoundError(999),
    );

    await handleImportPeopleFromCollection(10, 999, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("Campaign 999 not found.\n");
  });

  it("sets exitCode 1 on CampaignExecutionError", async () => {
    vi.mocked(importPeopleFromCollection).mockRejectedValue(
      new CampaignExecutionError("import failed"),
    );

    await handleImportPeopleFromCollection(10, 1, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Failed to import people: import failed\n",
    );
  });

  it("sets exitCode 1 on InstanceNotRunningError", async () => {
    vi.mocked(importPeopleFromCollection).mockRejectedValue(
      new InstanceNotRunningError("No LinkedHelper instance is running."),
    );

    await handleImportPeopleFromCollection(10, 1, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "No LinkedHelper instance is running.\n",
    );
  });

  it("sets exitCode 1 on generic error", async () => {
    vi.mocked(importPeopleFromCollection).mockRejectedValue(
      new Error("timeout"),
    );

    await handleImportPeopleFromCollection(10, 1, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("timeout\n");
  });
});
