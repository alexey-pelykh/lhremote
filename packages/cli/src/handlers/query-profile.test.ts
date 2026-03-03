// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    DatabaseClient: vi.fn(),
    ProfileRepository: vi.fn(),
    discoverAllDatabases: vi.fn(),
  };
});

import {
  type Profile,
  ProfileNotFoundError,
  ProfileRepository,
} from "@lhremote/core";

import { handleQueryProfile } from "./query-profile.js";
import { mockDb, mockDiscovery } from "./testing/mock-helpers.js";

const MOCK_PROFILE: Profile = {
  id: 12345,
  miniProfile: {
    firstName: "Jane",
    lastName: "Doe",
    headline: "Engineering Manager at Acme",
    avatar: null,
  },
  externalIds: [
    { externalId: "jane-doe-12345", typeGroup: "public", isMemberId: false },
    { externalId: "987654321", typeGroup: "member", isMemberId: true },
  ],
  currentPosition: { company: "Acme Corp", title: "Engineering Manager" },
  education: [
    {
      school: "MIT",
      degree: "BS",
      field: "CS",
      startDate: "2014",
      endDate: "2018",
    },
  ],
  skills: [{ name: "TypeScript" }, { name: "React" }, { name: "Node.js" }],
  emails: ["jane@acme.com"],
};

const MOCK_PROFILE_WITH_POSITIONS: Profile = {
  ...MOCK_PROFILE,
  positions: [
    {
      company: "Acme Corp",
      title: "Engineering Manager",
      startDate: "2020-01",
      endDate: null,
      isCurrent: true,
    },
    {
      company: "Startup Inc",
      title: "Senior Engineer",
      startDate: "2018-06",
      endDate: "2019-12",
      isCurrent: false,
    },
  ],
};

function mockRepo(profile: Profile = MOCK_PROFILE, profileWithPositions: Profile = MOCK_PROFILE_WITH_POSITIONS) {
  vi.mocked(ProfileRepository).mockImplementation(function () {
    return {
      findById: vi.fn().mockImplementation((_id: number, options?: { includePositions?: boolean }) =>
        options?.includePositions ? profileWithPositions : profile,
      ),
      findByPublicId: vi.fn().mockImplementation((_slug: string, options?: { includePositions?: boolean }) =>
        options?.includePositions ? profileWithPositions : profile,
      ),
    } as unknown as ProfileRepository;
  });
}

function mockRepoNotFound() {
  vi.mocked(ProfileRepository).mockImplementation(function () {
    return {
      findById: vi.fn().mockImplementation((id: number) => {
        throw new ProfileNotFoundError(id);
      }),
      findByPublicId: vi.fn().mockImplementation((slug: string) => {
        throw new ProfileNotFoundError(slug);
      }),
    } as unknown as ProfileRepository;
  });
}

function setupSuccessPath() {
  mockDiscovery();
  mockDb();
  mockRepo();
}

describe("handleQueryProfile", () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("sets exitCode 1 when neither --person-id nor --public-id provided", async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockReturnValue(true);

    await handleQueryProfile({});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Exactly one of --person-id or --public-id must be provided.\n",
    );
  });

  it("sets exitCode 1 when both --person-id and --public-id provided", async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockReturnValue(true);

    await handleQueryProfile({ personId: 1, publicId: "jane-doe-12345" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Exactly one of --person-id or --public-id must be provided.\n",
    );
  });

  it("sets exitCode 1 when no databases found", async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockReturnValue(true);

    mockDiscovery(new Map());

    await handleQueryProfile({ personId: 1 });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "No LinkedHelper databases found.\n",
    );
  });

  it("sets exitCode 1 when profile not found", async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockReturnValue(true);

    mockDiscovery();
    mockDb();
    mockRepoNotFound();

    await handleQueryProfile({ personId: 999 });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("Profile not found.\n");
  });

  it("prints JSON with --json", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    setupSuccessPath();

    await handleQueryProfile({ personId: 12345, json: true });

    expect(process.exitCode).toBeUndefined();
    const output = stdoutSpy.mock.calls
      .map((call) => String(call[0]))
      .join("");
    expect(JSON.parse(output)).toEqual(MOCK_PROFILE);
  });

  it("prints human-friendly output with --person-id", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    setupSuccessPath();

    await handleQueryProfile({ personId: 12345 });

    expect(process.exitCode).toBeUndefined();
    expect(stdoutSpy).toHaveBeenCalledWith("Jane Doe (#12345)\n");
    expect(stdoutSpy).toHaveBeenCalledWith(
      "Engineering Manager at Acme\n",
    );
    expect(stdoutSpy).toHaveBeenCalledWith(
      "\nCurrent: Engineering Manager at Acme Corp\n",
    );
    expect(stdoutSpy).toHaveBeenCalledWith(
      "Skills: TypeScript, React, Node.js\n",
    );
    expect(stdoutSpy).toHaveBeenCalledWith("Email: jane@acme.com\n");
    expect(stdoutSpy).toHaveBeenCalledWith(
      "\nLinkedIn: linkedin.com/in/jane-doe-12345\n",
    );
  });

  it("prints human-friendly output with --public-id", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    setupSuccessPath();

    await handleQueryProfile({ publicId: "jane-doe-12345" });

    expect(process.exitCode).toBeUndefined();
    expect(stdoutSpy).toHaveBeenCalledWith("Jane Doe (#12345)\n");
  });

  it("prints positions when --include-positions is set", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    setupSuccessPath();

    await handleQueryProfile({ personId: 12345, includePositions: true });

    expect(process.exitCode).toBeUndefined();
    expect(stdoutSpy).toHaveBeenCalledWith("\nPositions:\n");
    expect(stdoutSpy).toHaveBeenCalledWith(
      "  Engineering Manager at Acme Corp (2020-01 – present)\n",
    );
    expect(stdoutSpy).toHaveBeenCalledWith(
      "  Senior Engineer at Startup Inc (2018-06 – 2019-12)\n",
    );
  });

  it("does not print positions section by default", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    setupSuccessPath();

    await handleQueryProfile({ personId: 12345 });

    const calls = stdoutSpy.mock.calls.map((c) => String(c[0]));
    expect(calls).not.toContainEqual(expect.stringContaining("Positions:"));
  });

  it("includes positions in JSON output when --include-positions is set", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    setupSuccessPath();

    await handleQueryProfile({ personId: 12345, includePositions: true, json: true });

    expect(process.exitCode).toBeUndefined();
    const output = stdoutSpy.mock.calls
      .map((call) => String(call[0]))
      .join("");
    const parsed = JSON.parse(output);
    expect(parsed.positions).toHaveLength(2);
    expect(parsed.positions[0].company).toBe("Acme Corp");
  });

  it("handles profile with no headline or current position", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    const minimalProfile: Profile = {
      id: 2,
      miniProfile: {
        firstName: "Bob",
        lastName: null,
        headline: null,
        avatar: null,
      },
      externalIds: [],
      currentPosition: null,
      education: [],
      skills: [],
      emails: [],
    };

    mockDiscovery();
    mockDb();
    mockRepo(minimalProfile);

    await handleQueryProfile({ personId: 2 });

    expect(process.exitCode).toBeUndefined();
    expect(stdoutSpy).toHaveBeenCalledWith("Bob (#2)\n");
    const calls = stdoutSpy.mock.calls.map((c) => String(c[0]));
    expect(calls).not.toContainEqual(expect.stringContaining("Current:"));
    expect(calls).not.toContainEqual(expect.stringContaining("Skills:"));
    expect(calls).not.toContainEqual(expect.stringContaining("Email:"));
    expect(calls).not.toContainEqual(expect.stringContaining("LinkedIn:"));
  });

  it("closes database after successful lookup", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);

    mockDiscovery();
    const { close } = mockDb();
    mockRepo();

    await handleQueryProfile({ personId: 12345 });

    expect(close).toHaveBeenCalledOnce();
  });

  it("closes database after failed lookup", async () => {
    vi.spyOn(process.stderr, "write").mockReturnValue(true);

    mockDiscovery();
    const { close } = mockDb();
    mockRepoNotFound();

    await handleQueryProfile({ personId: 999 });

    expect(close).toHaveBeenCalledOnce();
  });

  it("sets exitCode 1 on unexpected database error", async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockReturnValue(true);

    mockDiscovery();
    mockDb();
    vi.mocked(ProfileRepository).mockImplementation(function () {
      return {
        findById: vi.fn().mockImplementation(() => {
          throw new Error("database locked");
        }),
      } as unknown as ProfileRepository;
    });

    await handleQueryProfile({ personId: 1 });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("database locked\n");
  });
});
