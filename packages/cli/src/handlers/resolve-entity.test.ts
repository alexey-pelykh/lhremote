// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return { ...actual, resolveLinkedInEntity: vi.fn() };
});

import {
  resolveLinkedInEntity,
  type ResolveLinkedInEntityOutput,
} from "@lhremote/core";
import { handleResolveEntity } from "./resolve-entity.js";
import { getStderr, getStdout } from "./testing/mock-helpers.js";

const MOCK_RESULT: ResolveLinkedInEntityOutput = {
  matches: [
    { id: "urn:li:organization:1441", name: "Google", type: "COMPANY" },
    { id: "urn:li:organization:1442", name: "Google Cloud", type: "COMPANY" },
  ],
  strategy: "public",
};

describe("handleResolveEntity", () => {
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

  it("prints JSON with --json", async () => {
    vi.mocked(resolveLinkedInEntity).mockResolvedValue(MOCK_RESULT);

    await handleResolveEntity("COMPANY", "Google", { json: true });

    expect(process.exitCode).toBeUndefined();
    const output = JSON.parse(getStdout(stdoutSpy));
    expect(output.matches).toHaveLength(2);
    expect(output.strategy).toBe("public");
    expect(output.matches[0].name).toBe("Google");
  });

  it("prints human-readable output with matches", async () => {
    vi.mocked(resolveLinkedInEntity).mockResolvedValue(MOCK_RESULT);

    await handleResolveEntity("COMPANY", "Google", {});

    expect(process.exitCode).toBeUndefined();
    const output = getStdout(stdoutSpy);
    expect(output).toContain('"Google"');
    expect(output).toContain("COMPANY");
    expect(output).toContain("public");
    expect(output).toContain("urn:li:organization:1441");
    expect(output).toContain("Google Cloud");
  });

  it("sets exitCode 1 for invalid entity type", async () => {
    await handleResolveEntity("INVALID", "Google", {});

    expect(process.exitCode).toBe(1);
    expect(getStderr(stderrSpy)).toContain("Unknown entity type");
    expect(resolveLinkedInEntity).not.toHaveBeenCalled();
  });

  it("prints no-matches message when empty", async () => {
    vi.mocked(resolveLinkedInEntity).mockResolvedValue({
      matches: [],
      strategy: "public",
    });

    await handleResolveEntity("COMPANY", "xyznonexistent", {});

    expect(process.exitCode).toBeUndefined();
    const output = getStdout(stdoutSpy);
    expect(output).toContain("No matches found");
  });

  it("limits output when --limit is provided", async () => {
    vi.mocked(resolveLinkedInEntity).mockResolvedValue(MOCK_RESULT);

    await handleResolveEntity("COMPANY", "Google", { limit: 1 });

    expect(process.exitCode).toBeUndefined();
    const output = getStdout(stdoutSpy);
    expect(output).toContain("Google");
    expect(output).not.toContain("Google Cloud");
  });

  it("limits JSON output when --limit is provided", async () => {
    vi.mocked(resolveLinkedInEntity).mockResolvedValue(MOCK_RESULT);

    await handleResolveEntity("COMPANY", "Google", {
      json: true,
      limit: 1,
    });

    const output = JSON.parse(getStdout(stdoutSpy));
    expect(output.matches).toHaveLength(1);
    expect(output.matches[0].name).toBe("Google");
  });

  it("sets exitCode on error", async () => {
    vi.mocked(resolveLinkedInEntity).mockRejectedValue(
      new Error("connection refused"),
    );

    await handleResolveEntity("COMPANY", "Google", {});

    expect(process.exitCode).toBe(1);
    expect(getStderr(stderrSpy)).toContain("connection refused");
  });
});
