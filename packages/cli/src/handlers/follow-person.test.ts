// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    followPerson: vi.fn(),
  };
});

import {
  type EphemeralActionResult,
  CampaignExecutionError,
  CampaignTimeoutError,
  followPerson,
} from "@lhremote/core";

import { handleFollowPerson } from "./follow-person.js";
import { getStderr, getStdout } from "./testing/mock-helpers.js";

const MOCK_RESULT: EphemeralActionResult = {
  success: true,
  personId: 100,
  results: [{ id: 1, actionVersionId: 1, personId: 100, result: 1, platform: null, createdAt: "2026-01-01T00:00:00Z", profile: null }],
};

describe("handleFollowPerson", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("outputs JSON result on success", async () => {
    vi.mocked(followPerson).mockResolvedValue(MOCK_RESULT);

    await handleFollowPerson({ personId: 100, json: true });

    expect(process.exitCode).toBeUndefined();
    const stdout = getStdout(stdoutSpy);
    const parsed = JSON.parse(stdout) as EphemeralActionResult;
    expect(parsed.success).toBe(true);
    expect(parsed.personId).toBe(100);
  });

  it("outputs human-readable result on success", async () => {
    vi.mocked(followPerson).mockResolvedValue(MOCK_RESULT);

    await handleFollowPerson({ personId: 100 });

    expect(process.exitCode).toBeUndefined();
    expect(getStdout(stdoutSpy)).toContain("succeeded");
  });

  it("returns error when neither personId nor url provided", async () => {
    await handleFollowPerson({});

    expect(process.exitCode).toBe(1);
    expect(getStderr(stderrSpy)).toContain("Exactly one of --person-id or --url");
    expect(followPerson).not.toHaveBeenCalled();
  });

  it("handles CampaignExecutionError", async () => {
    vi.mocked(followPerson).mockRejectedValue(
      new CampaignExecutionError("Person 100 not found"),
    );

    await handleFollowPerson({ personId: 100 });

    expect(process.exitCode).toBe(1);
    expect(getStderr(stderrSpy)).toContain("Person 100 not found");
  });

  it("handles CampaignTimeoutError", async () => {
    vi.mocked(followPerson).mockRejectedValue(
      new CampaignTimeoutError("Timed out", 42),
    );

    await handleFollowPerson({ personId: 100 });

    expect(process.exitCode).toBe(1);
    expect(getStderr(stderrSpy)).toContain("Timed out");
  });
});
