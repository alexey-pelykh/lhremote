// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/account-resolution.js", () => ({
  resolveAccount: vi.fn(),
}));

vi.mock("../services/instance-context.js", () => ({
  withInstanceDatabase: vi.fn(),
}));

vi.mock("../services/ephemeral-campaign.js", () => ({
  EphemeralCampaignService: vi.fn(),
}));

import type { InstanceDatabaseContext } from "../services/instance-context.js";
import { resolveAccount } from "../services/account-resolution.js";
import { withInstanceDatabase } from "../services/instance-context.js";
import { EphemeralCampaignService } from "../services/ephemeral-campaign.js";
import { executeEphemeralAction } from "./ephemeral-action.js";

const MOCK_RESULT = {
  success: true,
  personId: 42,
  results: [{ result: 1 }],
};

const mockExecute = vi.fn().mockResolvedValue(MOCK_RESULT);

function setupMocks() {
  vi.mocked(resolveAccount).mockResolvedValue(1);

  vi.mocked(withInstanceDatabase).mockImplementation(
    async (_cdpPort, _accountId, callback) =>
      callback({
        accountId: 1,
        instance: {},
        db: {},
      } as unknown as InstanceDatabaseContext),
  );

  vi.mocked(EphemeralCampaignService).mockImplementation(function () {
    return { execute: mockExecute } as unknown as EphemeralCampaignService;
  });
}

describe("executeEphemeralAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when neither personId nor url is provided", async () => {
    await expect(
      executeEphemeralAction("Follow", { cdpPort: 9222 }),
    ).rejects.toThrow("Exactly one of personId or url must be provided");
  });

  it("throws when both personId and url are provided", async () => {
    await expect(
      executeEphemeralAction("Follow", {
        personId: 42,
        url: "https://www.linkedin.com/in/test",
        cdpPort: 9222,
      }),
    ).rejects.toThrow("Exactly one of personId or url must be provided");
  });

  it("resolves account and executes action with personId target", async () => {
    setupMocks();

    const result = await executeEphemeralAction("Follow", {
      personId: 42,
      cdpPort: 9222,
    });

    expect(resolveAccount).toHaveBeenCalledWith(9222, {});
    expect(withInstanceDatabase).toHaveBeenCalledWith(
      9222,
      1,
      expect.any(Function),
      { db: { readOnly: false } },
    );
    expect(mockExecute).toHaveBeenCalledWith("Follow", 42, undefined, {});
    expect(result).toBe(MOCK_RESULT);
  });

  it("passes url as target when personId is not provided", async () => {
    setupMocks();

    await executeEphemeralAction("Follow", {
      url: "https://www.linkedin.com/in/test",
      cdpPort: 9222,
    });

    expect(mockExecute).toHaveBeenCalledWith(
      "Follow",
      "https://www.linkedin.com/in/test",
      undefined,
      {},
    );
  });

  it("forwards actionSettings to execute", async () => {
    setupMocks();

    const settings = { skipIfUnfollowable: true, mode: "follow" };

    await executeEphemeralAction(
      "Follow",
      { personId: 42, cdpPort: 9222 },
      settings,
    );

    expect(mockExecute).toHaveBeenCalledWith("Follow", 42, settings, {});
  });

  it("forwards keepCampaign option when provided", async () => {
    setupMocks();

    await executeEphemeralAction("Follow", {
      personId: 42,
      cdpPort: 9222,
      keepCampaign: true,
    });

    expect(mockExecute).toHaveBeenCalledWith("Follow", 42, undefined, {
      keepCampaign: true,
    });
  });

  it("omits keepCampaign from options when undefined", async () => {
    setupMocks();

    await executeEphemeralAction("Follow", {
      personId: 42,
      cdpPort: 9222,
    });

    expect(mockExecute).toHaveBeenCalledWith("Follow", 42, undefined, {});
  });

  it("passes connection options to resolveAccount", async () => {
    setupMocks();

    await executeEphemeralAction("Follow", {
      personId: 42,
      cdpPort: 1234,
      cdpHost: "192.168.1.1",
      allowRemote: true,
    });

    expect(resolveAccount).toHaveBeenCalledWith(1234, {
      host: "192.168.1.1",
      allowRemote: true,
    });
  });

  it("omits undefined connection options from resolveAccount", async () => {
    setupMocks();

    await executeEphemeralAction("Follow", {
      personId: 42,
      cdpPort: 9222,
    });

    expect(resolveAccount).toHaveBeenCalledWith(9222, {});
  });

  it("propagates resolveAccount errors", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(
      new Error("connection refused"),
    );

    await expect(
      executeEphemeralAction("Follow", { personId: 42, cdpPort: 9222 }),
    ).rejects.toThrow("connection refused");
  });

  it("propagates withInstanceDatabase errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withInstanceDatabase).mockRejectedValue(
      new Error("instance not running"),
    );

    await expect(
      executeEphemeralAction("Follow", { personId: 42, cdpPort: 9222 }),
    ).rejects.toThrow("instance not running");
  });

  it("propagates EphemeralCampaignService.execute errors", async () => {
    vi.mocked(resolveAccount).mockResolvedValue(1);
    vi.mocked(withInstanceDatabase).mockImplementation(
      async (_cdpPort, _accountId, callback) =>
        callback({
          accountId: 1,
          instance: {},
          db: {},
        } as unknown as InstanceDatabaseContext),
    );
    vi.mocked(EphemeralCampaignService).mockImplementation(function () {
      return {
        execute: vi.fn().mockRejectedValue(new Error("campaign failed")),
      } as unknown as EphemeralCampaignService;
    });

    await expect(
      executeEphemeralAction("Follow", { personId: 42, cdpPort: 9222 }),
    ).rejects.toThrow("campaign failed");
  });
});
