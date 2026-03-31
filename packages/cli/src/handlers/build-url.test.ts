// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return { ...actual, buildLinkedInUrl: vi.fn() };
});

import { buildLinkedInUrl, type BuildLinkedInUrlOutput } from "@lhremote/core";
import { handleBuildUrl } from "./build-url.js";
import { getStderr, getStdout } from "./testing/mock-helpers.js";

const MOCK_RESULT: BuildLinkedInUrlOutput = {
  url: "https://www.linkedin.com/search/results/people/?keywords=engineer",
  sourceType: "SearchPage",
  warnings: [],
};

describe("handleBuildUrl", () => {
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

  it("prints URL in human-readable mode", () => {
    vi.mocked(buildLinkedInUrl).mockReturnValue(MOCK_RESULT);

    handleBuildUrl("SearchPage", { keywords: "engineer" });

    expect(process.exitCode).toBeUndefined();
    const output = getStdout(stdoutSpy);
    expect(output).toContain(
      "https://www.linkedin.com/search/results/people/?keywords=engineer",
    );
  });

  it("prints JSON with --json", () => {
    vi.mocked(buildLinkedInUrl).mockReturnValue(MOCK_RESULT);

    handleBuildUrl("SearchPage", { keywords: "engineer", json: true });

    expect(process.exitCode).toBeUndefined();
    const output = JSON.parse(getStdout(stdoutSpy));
    expect(output.url).toBe(
      "https://www.linkedin.com/search/results/people/?keywords=engineer",
    );
    expect(output.sourceType).toBe("SearchPage");
    expect(output.warnings).toEqual([]);
  });

  it("shows warnings on stderr", () => {
    vi.mocked(buildLinkedInUrl).mockReturnValue({
      ...MOCK_RESULT,
      warnings: ["Some filter was ignored"],
    });

    handleBuildUrl("SearchPage", { keywords: "engineer" });

    expect(process.exitCode).toBeUndefined();
    expect(getStderr(stderrSpy)).toContain("Warning: Some filter was ignored");
  });

  it("validates filter format: invalid format sets exitCode 1", () => {
    handleBuildUrl("SNSearchPage", { filter: ["BAD"] });

    expect(process.exitCode).toBe(1);
    expect(getStderr(stderrSpy)).toContain("Invalid filter format");
    expect(buildLinkedInUrl).not.toHaveBeenCalled();
  });

  it("validates selectionType: invalid selection sets exitCode 1", () => {
    handleBuildUrl("SNSearchPage", {
      filter: ["TYPE|ID|BADSELECTION"],
    });

    expect(process.exitCode).toBe(1);
    expect(getStderr(stderrSpy)).toContain("Invalid selectionType");
    expect(buildLinkedInUrl).not.toHaveBeenCalled();
  });

  it("parses 3-segment filter format", () => {
    vi.mocked(buildLinkedInUrl).mockReturnValue(MOCK_RESULT);

    handleBuildUrl("SNSearchPage", {
      filter: ["CURRENT_COMPANY|urn:li:organization:1441|INCLUDED"],
    });

    expect(process.exitCode).toBeUndefined();
    expect(buildLinkedInUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [
          {
            type: "CURRENT_COMPANY",
            values: [
              {
                id: "urn:li:organization:1441",
                selectionType: "INCLUDED",
              },
            ],
          },
        ],
      }),
    );
  });

  it("parses 4-segment filter format with text", () => {
    vi.mocked(buildLinkedInUrl).mockReturnValue(MOCK_RESULT);

    handleBuildUrl("SNSearchPage", {
      filter: ["CURRENT_COMPANY|urn:li:organization:1441|Google|INCLUDED"],
    });

    expect(process.exitCode).toBeUndefined();
    expect(buildLinkedInUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [
          {
            type: "CURRENT_COMPANY",
            values: [
              {
                id: "urn:li:organization:1441",
                text: "Google",
                selectionType: "INCLUDED",
              },
            ],
          },
        ],
      }),
    );
  });

  it("sets exitCode on core error", () => {
    vi.mocked(buildLinkedInUrl).mockImplementation(() => {
      throw new Error("Unknown source type");
    });

    handleBuildUrl("InvalidType", {});

    expect(process.exitCode).toBe(1);
    expect(getStderr(stderrSpy)).toContain("Unknown source type");
  });
});
