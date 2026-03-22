// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    dismissErrors: vi.fn(),
  };
});

import { type DismissErrorsOutput, dismissErrors } from "@lhremote/core";

import { handleDismissErrors } from "./dismiss-errors.js";

const mockedDismissErrors = vi.mocked(dismissErrors);

describe("handleDismissErrors", () => {
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

    const output: DismissErrorsOutput = {
      accountId: 1,
      dismissed: 2,
      nonDismissable: 0,
    };

    mockedDismissErrors.mockResolvedValue(output);

    await handleDismissErrors({ json: true });

    expect(process.exitCode).toBeUndefined();
    const text = stdoutSpy.mock.calls
      .map((call) => String(call[0]))
      .join("");
    expect(JSON.parse(text)).toEqual(output);
  });

  it("prints human-friendly output when popups dismissed", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    mockedDismissErrors.mockResolvedValue({
      accountId: 1,
      dismissed: 2,
      nonDismissable: 0,
    });

    await handleDismissErrors({});

    expect(process.exitCode).toBeUndefined();
    expect(stdoutSpy).toHaveBeenCalledWith("Account: 1\n");
    expect(stdoutSpy).toHaveBeenCalledWith("Dismissed: 2\n");
  });

  it("prints non-dismissable count when present", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    mockedDismissErrors.mockResolvedValue({
      accountId: 1,
      dismissed: 0,
      nonDismissable: 3,
    });

    await handleDismissErrors({});

    expect(stdoutSpy).toHaveBeenCalledWith("Non-dismissable: 3\n");
  });

  it("hides non-dismissable line when zero", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    mockedDismissErrors.mockResolvedValue({
      accountId: 1,
      dismissed: 1,
      nonDismissable: 0,
    });

    await handleDismissErrors({});

    const calls = stdoutSpy.mock.calls.map((c) => String(c[0]));
    expect(calls).not.toContain(expect.stringContaining("Non-dismissable"));
  });

  it("sets exitCode 1 on error", async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockReturnValue(true);

    mockedDismissErrors.mockRejectedValue(new Error("unexpected"));

    await handleDismissErrors({});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("unexpected\n");
  });
});
