// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return { ...actual, getThrottleStatus: vi.fn() };
});

import { getThrottleStatus } from "@lhremote/core";
import { handleGetThrottleStatus } from "./get-throttle-status.js";

describe("handleGetThrottleStatus", () => {
  let stdoutChunks: string[];
  let stderrChunks: string[];
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutChunks = [];
    stderrChunks = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdoutChunks.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderrChunks.push(String(chunk));
      return true;
    });
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = originalExitCode;
  });

  it("outputs JSON when --json flag is set and not throttled", async () => {
    vi.mocked(getThrottleStatus).mockResolvedValue({ throttled: false, since: null });

    await handleGetThrottleStatus({ json: true });

    const output = JSON.parse(stdoutChunks.join(""));
    expect(output).toEqual({ throttled: false, since: null });
  });

  it("outputs JSON when --json flag is set and throttled", async () => {
    const since = "2026-03-21T10:00:00.000Z";
    vi.mocked(getThrottleStatus).mockResolvedValue({ throttled: true, since });

    await handleGetThrottleStatus({ json: true });

    const output = JSON.parse(stdoutChunks.join(""));
    expect(output).toEqual({ throttled: true, since });
  });

  it("outputs human-readable text when not throttled", async () => {
    vi.mocked(getThrottleStatus).mockResolvedValue({ throttled: false, since: null });

    await handleGetThrottleStatus({});

    expect(stdoutChunks.join("")).toContain("Not throttled.");
  });

  it("outputs human-readable text when throttled", async () => {
    const since = "2026-03-21T10:00:00.000Z";
    vi.mocked(getThrottleStatus).mockResolvedValue({ throttled: true, since });

    await handleGetThrottleStatus({});

    const output = stdoutChunks.join("");
    expect(output).toContain("THROTTLED");
    expect(output).toContain(since);
  });

  it("sets exit code 1 on error", async () => {
    vi.mocked(getThrottleStatus).mockRejectedValue(new Error("instance not running"));

    await handleGetThrottleStatus({});

    expect(process.exitCode).toBe(1);
    expect(stderrChunks.join("")).toContain("instance not running");
  });
});
