// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    visitProfile: vi.fn(),
  };
});

import {
  type VisitProfileOutput,
  type Profile,
  InstanceNotRunningError,
  visitProfile,
} from "@lhremote/core";

import { handleVisitProfile } from "./visit-profile.js";
import { getStderr, getStdout } from "./testing/mock-helpers.js";

const MOCK_PROFILE: Profile = {
  id: 100,
  miniProfile: {
    firstName: "Jane",
    lastName: "Doe",
    headline: "Software Engineer at Acme",
    avatar: null,
  },
  externalIds: [{ externalId: "jane-doe-123", typeGroup: "public", isMemberId: false }],
  currentPosition: { company: "Acme Corp", title: "Senior Engineer" },
  positions: [
    {
      company: "Acme Corp",
      title: "Senior Engineer",
      startDate: "2023-01",
      endDate: null,
      isCurrent: true,
    },
  ],
  education: [
    {
      school: "MIT",
      degree: "BS",
      field: "Computer Science",
      startDate: "2015",
      endDate: "2019",
    },
  ],
  skills: [{ name: "TypeScript" }, { name: "Node.js" }],
  emails: ["jane@example.com"],
};

const MOCK_RESULT: VisitProfileOutput = {
  success: true as const,
  actionType: "VisitAndExtract",
  profile: MOCK_PROFILE,
};

describe("handleVisitProfile", () => {
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

  it("exits with error when neither personId nor url provided", async () => {
    await handleVisitProfile({});

    expect(process.exitCode).toBe(1);
    expect(getStderr(stderrSpy)).toContain("Exactly one of --person-id or --url must be provided");
    expect(visitProfile).not.toHaveBeenCalled();
  });

  it("exits with error when both personId and url provided", async () => {
    await handleVisitProfile({ personId: 100, url: "https://www.linkedin.com/in/jane" });

    expect(process.exitCode).toBe(1);
    expect(getStderr(stderrSpy)).toContain("Exactly one of --person-id or --url must be provided");
    expect(visitProfile).not.toHaveBeenCalled();
  });

  it("prints JSON with --json", async () => {
    vi.mocked(visitProfile).mockResolvedValue(MOCK_RESULT);

    await handleVisitProfile({ personId: 100, json: true });

    expect(process.exitCode).toBeUndefined();
    const output = JSON.parse(getStdout(stdoutSpy));
    expect(output.success).toBe(true);
    expect(output.actionType).toBe("VisitAndExtract");
    expect(output.profile.id).toBe(100);
  });

  it("prints human-readable output by default", async () => {
    vi.mocked(visitProfile).mockResolvedValue(MOCK_RESULT);

    await handleVisitProfile({ personId: 100 });

    expect(process.exitCode).toBeUndefined();
    const output = getStdout(stdoutSpy);
    expect(output).toContain("Jane Doe (#100)");
    expect(output).toContain("Software Engineer at Acme");
    expect(output).toContain("Senior Engineer at Acme Corp");
    expect(output).toContain("TypeScript, Node.js");
    expect(output).toContain("jane@example.com");
    expect(output).toContain("linkedin.com/in/jane-doe-123");
  });

  it("prints positions in human-readable output", async () => {
    vi.mocked(visitProfile).mockResolvedValue(MOCK_RESULT);

    await handleVisitProfile({ personId: 100 });

    const output = getStdout(stdoutSpy);
    expect(output).toContain("Positions:");
    expect(output).toContain("Senior Engineer at Acme Corp");
  });

  it("prints education in human-readable output", async () => {
    vi.mocked(visitProfile).mockResolvedValue(MOCK_RESULT);

    await handleVisitProfile({ personId: 100 });

    const output = getStdout(stdoutSpy);
    expect(output).toContain("Education:");
    expect(output).toContain("BS in Computer Science");
    expect(output).toContain("MIT");
  });

  it("handles null school in education", async () => {
    vi.mocked(visitProfile).mockResolvedValue({
      ...MOCK_RESULT,
      profile: {
        ...MOCK_PROFILE,
        education: [
          { school: null, degree: "MBA", field: null, startDate: "2020", endDate: "2022" },
        ],
      },
    });

    await handleVisitProfile({ personId: 100 });

    const output = getStdout(stdoutSpy);
    expect(output).toContain("Education:");
    expect(output).toContain("MBA");
    expect(output).not.toContain("null");
  });

  it("passes url to operation when provided", async () => {
    vi.mocked(visitProfile).mockResolvedValue(MOCK_RESULT);

    await handleVisitProfile({ url: "https://www.linkedin.com/in/jane-doe-123" });

    expect(visitProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://www.linkedin.com/in/jane-doe-123",
      }),
    );
  });

  it("prints progress to stderr", async () => {
    vi.mocked(visitProfile).mockResolvedValue(MOCK_RESULT);

    await handleVisitProfile({ personId: 100 });

    const stderr = getStderr(stderrSpy);
    expect(stderr).toContain("Visiting profile...");
    expect(stderr).toContain("Done.");
  });

  it("passes extractCurrentOrganizations when provided", async () => {
    vi.mocked(visitProfile).mockResolvedValue(MOCK_RESULT);

    await handleVisitProfile({ personId: 100, extractCurrentOrganizations: true });

    expect(visitProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        personId: 100,
        extractCurrentOrganizations: true,
      }),
    );
  });

  it("sets exitCode on error", async () => {
    vi.mocked(visitProfile).mockRejectedValue(
      new Error("No accounts found."),
    );

    await handleVisitProfile({ personId: 100 });

    expect(process.exitCode).toBe(1);
    expect(getStderr(stderrSpy)).toContain("No accounts found.");
  });

  it("sets exitCode when no instance running", async () => {
    vi.mocked(visitProfile).mockRejectedValue(
      new InstanceNotRunningError(
        "No LinkedHelper instance is running. Use start-instance first.",
      ),
    );

    await handleVisitProfile({ personId: 100 });

    expect(process.exitCode).toBe(1);
    expect(getStderr(stderrSpy)).toContain(
      "No LinkedHelper instance is running. Use start-instance first.",
    );
  });

  it("sets exitCode on unexpected error", async () => {
    vi.mocked(visitProfile).mockRejectedValue(
      new Error("connection reset"),
    );

    await handleVisitProfile({ personId: 100 });

    expect(process.exitCode).toBe(1);
    expect(getStderr(stderrSpy)).toContain("connection reset");
  });
});
