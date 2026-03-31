// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    isReferenceDataType: vi.fn(),
    getLinkedInReferenceData: vi.fn(),
  };
});

import {
  isReferenceDataType,
  getLinkedInReferenceData,
} from "@lhremote/core";
import { handleListReferenceData } from "./list-reference-data.js";
import { getStderr, getStdout } from "./testing/mock-helpers.js";

const MOCK_ITEMS = [
  { id: "1", name: "Tech" },
  { id: "2", name: "Finance" },
];

describe("handleListReferenceData", () => {
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

  it("prints JSON for valid type with --json", () => {
    vi.mocked(isReferenceDataType).mockReturnValue(true);
    vi.mocked(getLinkedInReferenceData).mockReturnValue(MOCK_ITEMS as never);

    handleListReferenceData("INDUSTRY", { json: true });

    expect(process.exitCode).toBeUndefined();
    const output = JSON.parse(getStdout(stdoutSpy));
    expect(output.dataType).toBe("INDUSTRY");
    expect(output.items).toHaveLength(2);
  });

  it("prints human-readable output for valid type", () => {
    vi.mocked(isReferenceDataType).mockReturnValue(true);
    vi.mocked(getLinkedInReferenceData).mockReturnValue(MOCK_ITEMS as never);

    handleListReferenceData("INDUSTRY", {});

    expect(process.exitCode).toBeUndefined();
    const output = getStdout(stdoutSpy);
    expect(output).toContain("INDUSTRY (2 entries):");
    expect(output).toContain("id: 1");
    expect(output).toContain("name: Tech");
    expect(output).toContain("id: 2");
    expect(output).toContain("name: Finance");
  });

  it("sets exitCode 1 for invalid type", () => {
    vi.mocked(isReferenceDataType).mockReturnValue(false);

    handleListReferenceData("INVALID", {});

    expect(process.exitCode).toBe(1);
    expect(getStderr(stderrSpy)).toContain("Unknown reference data type");
    expect(getLinkedInReferenceData).not.toHaveBeenCalled();
  });
});
