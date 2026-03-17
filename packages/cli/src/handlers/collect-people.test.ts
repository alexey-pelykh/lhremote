// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    collectPeople: vi.fn(),
  };
});

import {
  type CollectPeopleOutput,
  CollectionBusyError,
  CollectionError,
  collectPeople,
} from "@lhremote/core";

import { handleCollectPeople } from "./collect-people.js";
import { getStdout } from "./testing/mock-helpers.js";

const MOCK_RESULT: CollectPeopleOutput = {
  success: true as const,
  campaignId: 42,
  sourceType: "SearchPage",
};

describe("handleCollectPeople", () => {
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

  it("prints success message with detected source type", async () => {
    vi.mocked(collectPeople).mockResolvedValue(MOCK_RESULT);

    await handleCollectPeople(42, "https://www.linkedin.com/search/results/people/", {});

    expect(process.exitCode).toBeUndefined();
    expect(getStdout(stdoutSpy)).toContain(
      "Started collecting people (SearchPage) into campaign 42.",
    );
  });

  it("prints JSON with --json", async () => {
    vi.mocked(collectPeople).mockResolvedValue(MOCK_RESULT);

    await handleCollectPeople(42, "https://www.linkedin.com/search/results/people/", {
      json: true,
    });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout(stdoutSpy));
    expect(parsed.success).toBe(true);
    expect(parsed.campaignId).toBe(42);
    expect(parsed.sourceType).toBe("SearchPage");
  });

  it("passes all options to operation", async () => {
    vi.mocked(collectPeople).mockResolvedValue(MOCK_RESULT);

    await handleCollectPeople(42, "https://www.linkedin.com/search/results/people/", {
      limit: 100,
      maxPages: 5,
      pageSize: 25,
      sourceType: "SearchPage",
      cdpPort: 1234,
      cdpHost: "192.168.1.1",
      allowRemote: true,
    });

    expect(collectPeople).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: 42,
        sourceUrl: "https://www.linkedin.com/search/results/people/",
        limit: 100,
        maxPages: 5,
        pageSize: 25,
        sourceType: "SearchPage",
        cdpPort: 1234,
        cdpHost: "192.168.1.1",
        allowRemote: true,
      }),
    );
  });

  it("sets exitCode 1 when instance is busy", async () => {
    vi.mocked(collectPeople).mockRejectedValue(
      new CollectionBusyError("running"),
    );

    await handleCollectPeople(42, "https://www.linkedin.com/search/results/people/", {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Cannot collect — instance is busy (state: running).\n",
    );
  });

  it("sets exitCode 1 on CollectionError", async () => {
    vi.mocked(collectPeople).mockRejectedValue(
      new CollectionError("Unrecognized source URL: https://example.com — cannot determine LinkedIn page type"),
    );

    await handleCollectPeople(42, "https://example.com", {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Unrecognized source URL: https://example.com — cannot determine LinkedIn page type\n",
    );
  });

  it("sets exitCode 1 on generic error", async () => {
    vi.mocked(collectPeople).mockRejectedValue(new Error("timeout"));

    await handleCollectPeople(42, "https://www.linkedin.com/search/results/people/", {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("timeout\n");
  });
});
