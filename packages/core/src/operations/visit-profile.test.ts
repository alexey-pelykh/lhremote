// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/account-resolution.js", () => ({
  resolveAccount: vi.fn(),
}));

vi.mock("../services/instance-context.js", () => ({
  withInstanceDatabase: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  ProfileRepository: vi.fn(),
}));

import type { InstanceDatabaseContext } from "../services/instance-context.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withInstanceDatabase } from "../services/instance-context.js";
import { ProfileRepository } from "../db/index.js";
import { visitProfile } from "./visit-profile.js";

const MOCK_PROFILE = {
  id: 100,
  miniProfile: {
    firstName: "Jane",
    lastName: "Doe",
    headline: "Software Engineer",
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
  education: [],
  skills: [{ name: "TypeScript" }],
  emails: [],
};

const mockInstance = { executeAction: vi.fn().mockResolvedValue(undefined) };

function setupMocks() {
  vi.mocked(resolveAccount).mockResolvedValue(1);

  vi.mocked(withInstanceDatabase).mockImplementation(
    async (_cdpPort, _accountId, callback) =>
      callback({
        accountId: 1,
        instance: mockInstance,
        db: {},
      } as unknown as InstanceDatabaseContext),
  );

  vi.mocked(ProfileRepository).mockImplementation(function () {
    return {
      findById: vi.fn().mockReturnValue(MOCK_PROFILE),
      findByPublicId: vi.fn().mockReturnValue(MOCK_PROFILE),
    } as unknown as ProfileRepository;
  });
}

describe("visitProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when neither personId nor url is provided", async () => {
    await expect(
      visitProfile({ cdpPort: 9222 }),
    ).rejects.toThrow("Exactly one of personId or url must be provided");
  });

  it("throws when both personId and url are provided", async () => {
    await expect(
      visitProfile({ personId: 100, url: "https://www.linkedin.com/in/jane-doe-123", cdpPort: 9222 }),
    ).rejects.toThrow("Exactly one of personId or url must be provided");
  });

  it("returns success with profile after visiting by personId", async () => {
    setupMocks();

    const result = await visitProfile({
      personId: 100,
      cdpPort: 9222,
    });

    expect(result.success).toBe(true);
    expect(result.actionType).toBe("VisitAndExtract");
    expect(result.profile).toBe(MOCK_PROFILE);
  });

  it("calls instance.executeAction with VisitAndExtract and personIds", async () => {
    setupMocks();

    await visitProfile({
      personId: 100,
      cdpPort: 9222,
    });

    expect(mockInstance.executeAction).toHaveBeenCalledWith(
      "VisitAndExtract",
      { personIds: [100] },
    );
  });

  it("resolves person from LinkedIn URL and visits", async () => {
    setupMocks();

    await visitProfile({
      url: "https://www.linkedin.com/in/jane-doe-123",
      cdpPort: 9222,
    });

    const mockRepo = vi.mocked(ProfileRepository).mock.results[0]
      ?.value as { findByPublicId: ReturnType<typeof vi.fn>; findById: ReturnType<typeof vi.fn> };
    expect(mockRepo.findByPublicId).toHaveBeenCalledWith("jane-doe-123");
    expect(mockInstance.executeAction).toHaveBeenCalledWith(
      "VisitAndExtract",
      { personIds: [100] },
    );
  });

  it("handles URL with trailing slash and query params", async () => {
    setupMocks();

    await visitProfile({
      url: "https://www.linkedin.com/in/jane-doe-123/?locale=en_US",
      cdpPort: 9222,
    });

    const mockRepo = vi.mocked(ProfileRepository).mock.results[0]
      ?.value as { findByPublicId: ReturnType<typeof vi.fn> };
    expect(mockRepo.findByPublicId).toHaveBeenCalledWith("jane-doe-123");
  });

  it("throws on invalid LinkedIn URL", async () => {
    setupMocks();

    await expect(
      visitProfile({ url: "https://example.com/not-linkedin", cdpPort: 9222 }),
    ).rejects.toThrow("Invalid LinkedIn profile URL");
  });

  it("passes extractCurrentOrganizations when provided", async () => {
    setupMocks();

    await visitProfile({
      personId: 100,
      cdpPort: 9222,
      extractCurrentOrganizations: true,
    });

    expect(mockInstance.executeAction).toHaveBeenCalledWith(
      "VisitAndExtract",
      { personIds: [100], extractCurrentOrganizations: true },
    );
  });

  it("omits extractCurrentOrganizations when undefined", async () => {
    setupMocks();

    await visitProfile({
      personId: 100,
      cdpPort: 9222,
    });

    expect(mockInstance.executeAction).toHaveBeenCalledWith(
      "VisitAndExtract",
      { personIds: [100] },
    );
  });

  it("queries profile with includePositions true", async () => {
    setupMocks();

    await visitProfile({
      personId: 100,
      cdpPort: 9222,
    });

    const mockRepo = vi.mocked(ProfileRepository).mock.results[0]
      ?.value as { findById: ReturnType<typeof vi.fn> };
    expect(mockRepo.findById).toHaveBeenCalledWith(100, { includePositions: true });
  });

  it("passes instanceTimeout to withInstanceDatabase", async () => {
    setupMocks();

    await visitProfile({
      personId: 100,
      cdpPort: 9222,
    });

    expect(withInstanceDatabase).toHaveBeenCalledWith(
      9222,
      1,
      expect.any(Function),
      { instanceTimeout: 120_000 },
    );
  });

  it("passes connection options to resolveAccount", async () => {
    setupMocks();

    await visitProfile({
      personId: 100,
      cdpPort: 1234,
      cdpHost: "192.168.1.1",
      allowRemote: true,
    });

    expect(resolveAccount).toHaveBeenCalledWith(1234, {
      host: "192.168.1.1",
      allowRemote: true,
    });
  });

  it("omits undefined connection options", async () => {
    setupMocks();

    await visitProfile({
      personId: 100,
      cdpPort: 9222,
    });

    expect(resolveAccount).toHaveBeenCalledWith(9222, {});
  });

  it("propagates resolveAccount errors", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("connection refused"));

    await expect(
      visitProfile({ personId: 100, cdpPort: 9222 }),
    ).rejects.toThrow("connection refused");
  });

  it("propagates withInstanceDatabase errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withInstanceDatabase).mockRejectedValue(
      new Error("instance not running"),
    );

    await expect(
      visitProfile({ personId: 100, cdpPort: 9222 }),
    ).rejects.toThrow("instance not running");
  });

  it("propagates ProfileRepository errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withInstanceDatabase).mockImplementation(
      async (_cdpPort, _accountId, callback) =>
        callback({
          accountId: 1,
          instance: mockInstance,
          db: {},
        } as unknown as InstanceDatabaseContext),
    );
    vi.mocked(ProfileRepository).mockImplementation(function () {
      return {
        findById: vi.fn().mockImplementation(() => {
          throw new Error("profile not found");
        }),
      } as unknown as ProfileRepository;
    });

    await expect(
      visitProfile({ personId: 100, cdpPort: 9222 }),
    ).rejects.toThrow("profile not found");
  });
});
