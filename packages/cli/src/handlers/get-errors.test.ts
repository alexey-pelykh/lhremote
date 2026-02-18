// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    getErrors: vi.fn(),
  };
});

import { type GetErrorsOutput, getErrors } from "@lhremote/core";

import { handleGetErrors } from "./get-errors.js";

const mockedGetErrors = vi.mocked(getErrors);

describe("handleGetErrors", () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("prints JSON with --json", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    const output: GetErrorsOutput = {
      accountId: 1,
      healthy: true,
      issues: [],
      popup: null,
    };

    mockedGetErrors.mockResolvedValue(output);

    await handleGetErrors({ json: true });

    expect(process.exitCode).toBeUndefined();
    const text = stdoutSpy.mock.calls
      .map((call) => String(call[0]))
      .join("");
    expect(JSON.parse(text)).toEqual(output);
  });

  it("prints healthy status in human-friendly format", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    mockedGetErrors.mockResolvedValue({
      accountId: 1,
      healthy: true,
      issues: [],
      popup: null,
    });

    await handleGetErrors({});

    expect(process.exitCode).toBeUndefined();
    expect(stdoutSpy).toHaveBeenCalledWith("Health: healthy\n");
    expect(stdoutSpy).toHaveBeenCalledWith("Account: 1\n");
    expect(stdoutSpy).toHaveBeenCalledWith("Issues: none\n");
    expect(stdoutSpy).toHaveBeenCalledWith("Popup: none\n");
  });

  it("prints dialog issues", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    mockedGetErrors.mockResolvedValue({
      accountId: 1,
      healthy: false,
      issues: [
        {
          type: "dialog",
          id: "d1",
          data: {
            id: "d1",
            options: {
              message: "Instance closed from launcher",
              controls: [
                { id: "ok", text: "OK" },
                { id: "cancel", text: "Cancel" },
              ],
            },
          },
        },
      ],
      popup: null,
    });

    await handleGetErrors({});

    expect(stdoutSpy).toHaveBeenCalledWith("Health: BLOCKED\n");
    expect(stdoutSpy).toHaveBeenCalledWith("Issues: 1\n");
    expect(stdoutSpy).toHaveBeenCalledWith(
      "  Dialog: Instance closed from launcher [OK, Cancel]\n",
    );
  });

  it("prints critical error issues", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    mockedGetErrors.mockResolvedValue({
      accountId: 1,
      healthy: false,
      issues: [
        {
          type: "critical-error",
          id: "e1",
          data: { message: "Database unavailable" },
        },
      ],
      popup: null,
    });

    await handleGetErrors({});

    expect(stdoutSpy).toHaveBeenCalledWith(
      "  Critical error: Database unavailable\n",
    );
  });

  it("prints blocking popup state", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    mockedGetErrors.mockResolvedValue({
      accountId: 1,
      healthy: false,
      issues: [],
      popup: { blocked: true, message: "Network issue", closable: false },
    });

    await handleGetErrors({});

    expect(stdoutSpy).toHaveBeenCalledWith(
      "Popup: Network issue (unclosable)\n",
    );
  });

  it("sets exitCode 1 on error", async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockReturnValue(true);

    mockedGetErrors.mockRejectedValue(new Error("unexpected"));

    await handleGetErrors({});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("unexpected\n");
  });
});
