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
  ProfileRepository,
} from "@lhremote/core";

import { handleQueryProfilesBulk } from "./query-profiles-bulk.js";
import { mockDb, mockDiscovery } from "./testing/mock-helpers.js";

const PROFILE_JANE: Profile = {
  id: 1,
  miniProfile: {
    firstName: "Jane",
    lastName: "Doe",
    headline: "Engineering Manager at Acme",
    avatar: null,
  },
  externalIds: [
    { externalId: "jane-doe-12345", typeGroup: "public", isMemberId: false },
  ],
  currentPosition: { company: "Acme Corp", title: "Engineering Manager" },
  education: [],
  skills: [],
  emails: [],
};

const PROFILE_BOB: Profile = {
  id: 2,
  miniProfile: {
    firstName: "Bob",
    lastName: null,
    headline: "Developer",
    avatar: null,
  },
  externalIds: [],
  currentPosition: null,
  education: [],
  skills: [],
  emails: [],
};

function mockRepo() {
  vi.mocked(ProfileRepository).mockImplementation(function () {
    return {
      findByIds: vi.fn().mockImplementation((ids: number[]) =>
        ids.map((id) => {
          if (id === 1) return PROFILE_JANE;
          if (id === 2) return PROFILE_BOB;
          return null;
        }),
      ),
      findByPublicIds: vi.fn().mockImplementation((slugs: string[]) =>
        slugs.map((s) => {
          if (s === "jane-doe-12345") return PROFILE_JANE;
          return null;
        }),
      ),
    } as unknown as ProfileRepository;
  });
}

function setupSuccessPath() {
  mockDiscovery();
  mockDb();
  mockRepo();
}

describe("handleQueryProfilesBulk", () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("sets exitCode 1 when no IDs provided", async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockReturnValue(true);

    await handleQueryProfilesBulk({});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "At least one --person-id or --public-id must be provided.\n",
    );
  });

  it("sets exitCode 1 when no databases found", async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockReturnValue(true);

    mockDiscovery(new Map());

    await handleQueryProfilesBulk({ personId: [1] });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "No LinkedHelper databases found.\n",
    );
  });

  it("prints JSON with --json", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    setupSuccessPath();

    await handleQueryProfilesBulk({ personId: [1, 2], json: true });

    expect(process.exitCode).toBeUndefined();
    const output = stdoutSpy.mock.calls
      .map((call) => String(call[0]))
      .join("");
    const parsed = JSON.parse(output);
    expect(parsed.byPersonId).toHaveLength(2);
    expect(parsed.byPersonId[0].id).toBe(1);
    expect(parsed.byPersonId[1].id).toBe(2);
  });

  it("prints JSON with null for not-found IDs", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    setupSuccessPath();

    await handleQueryProfilesBulk({ personId: [1, 999], json: true });

    const output = stdoutSpy.mock.calls
      .map((call) => String(call[0]))
      .join("");
    const parsed = JSON.parse(output);
    expect(parsed.byPersonId[0].id).toBe(1);
    expect(parsed.byPersonId[1]).toBeNull();
  });

  it("prints human-friendly output", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    setupSuccessPath();

    await handleQueryProfilesBulk({ personId: [1, 2] });

    expect(process.exitCode).toBeUndefined();
    expect(stdoutSpy).toHaveBeenCalledWith(
      "Found 2 profile(s):\n\n",
    );
    expect(stdoutSpy).toHaveBeenCalledWith(
      "#1  Jane Doe -- Engineering Manager at Acme Corp\n",
    );
    expect(stdoutSpy).toHaveBeenCalledWith(
      "#2  Bob -- Developer\n",
    );
  });

  it("shows not-found count in human-friendly output", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    setupSuccessPath();

    await handleQueryProfilesBulk({ personId: [1, 999] });

    expect(stdoutSpy).toHaveBeenCalledWith(
      "Found 1 profile(s), 1 not found:\n\n",
    );
  });

  it("sets exitCode 1 when no profiles found at all", async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockReturnValue(true);

    mockDiscovery();
    mockDb();
    vi.mocked(ProfileRepository).mockImplementation(function () {
      return {
        findByIds: vi.fn().mockImplementation((ids: number[]) =>
          ids.map(() => null),
        ),
        findByPublicIds: vi.fn().mockReturnValue([]),
      } as unknown as ProfileRepository;
    });

    await handleQueryProfilesBulk({ personId: [999] });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("No profiles found.\n");
  });

  it("supports publicId lookups", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    setupSuccessPath();

    await handleQueryProfilesBulk({
      publicId: ["jane-doe-12345"],
      json: true,
    });

    const output = stdoutSpy.mock.calls
      .map((call) => String(call[0]))
      .join("");
    const parsed = JSON.parse(output);
    expect(parsed.byPublicId).toHaveLength(1);
    expect(parsed.byPublicId[0].id).toBe(1);
  });

  it("supports both personId and publicId together", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    setupSuccessPath();

    await handleQueryProfilesBulk({
      personId: [2],
      publicId: ["jane-doe-12345"],
      json: true,
    });

    const output = stdoutSpy.mock.calls
      .map((call) => String(call[0]))
      .join("");
    const parsed = JSON.parse(output);
    expect(parsed.byPersonId).toHaveLength(1);
    expect(parsed.byPersonId[0].id).toBe(2);
    expect(parsed.byPublicId).toHaveLength(1);
    expect(parsed.byPublicId[0].id).toBe(1);
  });

  it("closes database after lookup", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);

    mockDiscovery();
    const { close } = mockDb();
    mockRepo();

    await handleQueryProfilesBulk({ personId: [1] });

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
        findByIds: vi.fn().mockImplementation(() => {
          throw new Error("database locked");
        }),
      } as unknown as ProfileRepository;
    });

    await handleQueryProfilesBulk({ personId: [1] });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("database locked\n");
  });
});
