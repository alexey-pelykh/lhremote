import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    resolveAccount: vi.fn(),
    withDatabase: vi.fn(),
    CampaignRepository: vi.fn(),
  };
});

import {
  CampaignNotFoundError,
  CampaignRepository,
  resolveAccount,
} from "@lhremote/core";

import { handleCampaignAddAction } from "./campaign-add-action.js";
import { mockResolveAccount, mockWithDatabase } from "./testing/mock-helpers.js";

const MOCK_CAMPAIGN = { id: 1, name: "Test", liAccountId: 42 };
const MOCK_ACTION = {
  id: 10,
  name: "Visit",
  config: { actionType: "VisitAndExtract" },
};

function mockRepo(campaign = MOCK_CAMPAIGN, action = MOCK_ACTION) {
  const getCampaign = vi.fn().mockReturnValue(campaign);
  const addAction = vi.fn().mockReturnValue(action);
  vi.mocked(CampaignRepository).mockImplementation(function () {
    return { getCampaign, addAction } as unknown as CampaignRepository;
  });
  return { getCampaign, addAction };
}

function setupSuccessPath() {
  mockResolveAccount();
  mockWithDatabase();
  return mockRepo();
}

describe("handleCampaignAddAction", () => {
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

  function getStdout(): string {
    return stdoutSpy.mock.calls
      .map((call: unknown[]) => String(call[0]))
      .join("");
  }

  it("adds action and prints confirmation", async () => {
    setupSuccessPath();

    await handleCampaignAddAction(1, {
      name: "Visit",
      actionType: "VisitAndExtract",
    });

    expect(process.exitCode).toBeUndefined();
    expect(getStdout()).toContain(
      'Action added: #10 "Visit" (VisitAndExtract) to campaign #1',
    );
  });

  it("prints JSON with --json", async () => {
    setupSuccessPath();

    await handleCampaignAddAction(1, {
      name: "Visit",
      actionType: "VisitAndExtract",
      json: true,
    });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout());
    expect(parsed.id).toBe(10);
    expect(parsed.name).toBe("Visit");
  });

  it("passes optional parameters to addAction", async () => {
    const { addAction } = setupSuccessPath();

    await handleCampaignAddAction(1, {
      name: "Visit",
      actionType: "VisitAndExtract",
      description: "Visit and extract data",
      coolDown: 30,
      maxResults: 100,
    });

    expect(addAction).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        name: "Visit",
        actionType: "VisitAndExtract",
        description: "Visit and extract data",
        coolDown: 30,
        maxActionResultsPerIteration: 100,
      }),
      42,
    );
  });

  it("parses action settings JSON", async () => {
    const { addAction } = setupSuccessPath();

    await handleCampaignAddAction(1, {
      name: "Visit",
      actionType: "VisitAndExtract",
      actionSettings: '{"extractEmails":true}',
    });

    expect(addAction).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        actionSettings: { extractEmails: true },
      }),
      42,
    );
  });

  it("sets exitCode 1 on invalid action settings JSON", async () => {
    await handleCampaignAddAction(1, {
      name: "Visit",
      actionType: "VisitAndExtract",
      actionSettings: "bad json",
    });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Invalid JSON in --action-settings.\n",
    );
  });

  it("sets exitCode 1 when campaign not found", async () => {
    mockResolveAccount();
    mockWithDatabase();
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        getCampaign: vi.fn().mockImplementation(() => {
          throw new CampaignNotFoundError(999);
        }),
        addAction: vi.fn(),
      } as unknown as CampaignRepository;
    });

    await handleCampaignAddAction(999, {
      name: "Visit",
      actionType: "VisitAndExtract",
    });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("Campaign 999 not found.\n");
  });

  it("sets exitCode 1 when resolveAccount fails", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("timeout"));

    await handleCampaignAddAction(1, {
      name: "Visit",
      actionType: "VisitAndExtract",
    });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("timeout\n");
  });
});
