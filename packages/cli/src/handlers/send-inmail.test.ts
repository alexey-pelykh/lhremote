// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    sendInmail: vi.fn(),
  };
});

import {
  type EphemeralActionResult,
  CampaignExecutionError,
  CampaignTimeoutError,
  sendInmail,
} from "@lhremote/core";

import { handleSendInmail } from "./send-inmail.js";
import { getStderr, getStdout } from "./testing/mock-helpers.js";

const MOCK_RESULT: EphemeralActionResult = {
  success: true,
  personId: 100,
  results: [{ id: 1, actionVersionId: 1, personId: 100, result: 1, platform: null, createdAt: "2026-01-01T00:00:00Z", profile: null }],
};

describe("handleSendInmail", () => {
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
    vi.mocked(sendInmail).mockResolvedValue(MOCK_RESULT);

    await handleSendInmail({ personId: 100, messageTemplate: '{"type":"text","value":"Hello"}', json: true });

    expect(process.exitCode).toBeUndefined();
    const stdout = getStdout(stdoutSpy);
    const parsed = JSON.parse(stdout) as EphemeralActionResult;
    expect(parsed.success).toBe(true);
    expect(parsed.personId).toBe(100);
  });

  it("outputs human-readable result on success", async () => {
    vi.mocked(sendInmail).mockResolvedValue(MOCK_RESULT);

    await handleSendInmail({ personId: 100, messageTemplate: '{"type":"text","value":"Hello"}' });

    expect(process.exitCode).toBeUndefined();
    expect(getStdout(stdoutSpy)).toContain("sent");
  });

  it("returns error when neither personId nor url provided", async () => {
    await handleSendInmail({ messageTemplate: '{"type":"text","value":"Hello"}' });

    expect(process.exitCode).toBe(1);
    expect(getStderr(stderrSpy)).toContain("Exactly one of --person-id or --url");
    expect(sendInmail).not.toHaveBeenCalled();
  });

  it("returns error for invalid JSON in messageTemplate", async () => {
    await handleSendInmail({ personId: 100, messageTemplate: "not json" });

    expect(process.exitCode).toBe(1);
    expect(getStderr(stderrSpy)).toContain("Invalid JSON in --message-template");
    expect(sendInmail).not.toHaveBeenCalled();
  });

  it("returns error for invalid JSON in subjectTemplate", async () => {
    await handleSendInmail({ personId: 100, messageTemplate: '{"type":"text","value":"Hello"}', subjectTemplate: "not json" });

    expect(process.exitCode).toBe(1);
    expect(getStderr(stderrSpy)).toContain("Invalid JSON in --subject-template");
    expect(sendInmail).not.toHaveBeenCalled();
  });

  it("handles CampaignExecutionError", async () => {
    vi.mocked(sendInmail).mockRejectedValue(
      new CampaignExecutionError("Person 100 not found"),
    );

    await handleSendInmail({ personId: 100, messageTemplate: '{"type":"text","value":"Hello"}' });

    expect(process.exitCode).toBe(1);
    expect(getStderr(stderrSpy)).toContain("Person 100 not found");
  });

  it("handles CampaignTimeoutError", async () => {
    vi.mocked(sendInmail).mockRejectedValue(
      new CampaignTimeoutError("Timed out", 42),
    );

    await handleSendInmail({ personId: 100, messageTemplate: '{"type":"text","value":"Hello"}' });

    expect(process.exitCode).toBe(1);
    expect(getStderr(stderrSpy)).toContain("Timed out");
  });
});
