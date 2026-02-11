import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleDescribeActions } from "./describe-actions.js";

describe("handleDescribeActions", () => {
  const originalExitCode = process.exitCode;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.exitCode = undefined;
    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  function getStdout(): string {
    return stdoutSpy.mock.calls
      .map((call: unknown[]) => String(call[0]))
      .join("");
  }

  function getStderr(): string {
    return stderrSpy.mock.calls
      .map((call: unknown[]) => String(call[0]))
      .join("");
  }

  it("lists all action types in human-readable format", () => {
    handleDescribeActions({});

    expect(process.exitCode).toBeUndefined();
    const output = getStdout();
    expect(output).toContain("All action types");
    expect(output).toContain("VisitAndExtract");
    expect(output).toContain("MessageToPerson");
    expect(output).toContain("[messaging]");
    expect(output).toContain("[people]");
  });

  it("lists all action types as JSON", () => {
    handleDescribeActions({ json: true });

    expect(process.exitCode).toBeUndefined();
    const output = getStdout();
    const parsed = JSON.parse(output) as { actionTypes: unknown[] };
    expect(parsed.actionTypes).toBeDefined();
    expect(parsed.actionTypes.length).toBeGreaterThan(0);
  });

  it("filters by category", () => {
    handleDescribeActions({ category: "messaging" });

    expect(process.exitCode).toBeUndefined();
    const output = getStdout();
    expect(output).toContain('"messaging"');
    expect(output).toContain("MessageToPerson");
    expect(output).not.toContain("VisitAndExtract");
  });

  it("filters by category as JSON", () => {
    handleDescribeActions({ category: "people", json: true });

    expect(process.exitCode).toBeUndefined();
    const output = getStdout();
    const parsed = JSON.parse(output) as {
      actionTypes: Array<{ category: string }>;
    };
    for (const t of parsed.actionTypes) {
      expect(t.category).toBe("people");
    }
  });

  it("shows detail for a specific action type", () => {
    handleDescribeActions({ type: "VisitAndExtract" });

    expect(process.exitCode).toBeUndefined();
    const output = getStdout();
    expect(output).toContain("VisitAndExtract");
    expect(output).toContain("[people]");
    expect(output).toContain("Configuration:");
    expect(output).toContain("extractCurrentOrganizations");
  });

  it("shows detail for a specific action type as JSON", () => {
    handleDescribeActions({ type: "Waiter", json: true });

    expect(process.exitCode).toBeUndefined();
    const output = getStdout();
    const parsed = JSON.parse(output) as { name: string; category: string };
    expect(parsed.name).toBe("Waiter");
    expect(parsed.category).toBe("workflow");
  });

  it("errors on unknown action type", () => {
    handleDescribeActions({ type: "NonExistent" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Unknown action type: NonExistent\n",
    );
  });

  it("errors on invalid category", () => {
    handleDescribeActions({ category: "bogus" });

    expect(process.exitCode).toBe(1);
    const output = getStderr();
    expect(output).toContain("Invalid category: bogus");
    expect(output).toContain("Valid categories:");
  });

  it("shows example when available", () => {
    handleDescribeActions({ type: "VisitAndExtract" });

    const output = getStdout();
    expect(output).toContain("Example:");
    expect(output).toContain("extractCurrentOrganizations");
  });

  it("does not show example when not available", () => {
    handleDescribeActions({ type: "RemoveFromFirstConnection" });

    const output = getStdout();
    expect(output).not.toContain("Example:");
  });
});
