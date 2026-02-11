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
  ActionNotFoundError,
  CampaignNotFoundError,
  CampaignRepository,
  ExcludeListNotFoundError,
  resolveAccount,
} from "@lhremote/core";

import { handleCampaignExcludeList } from "./campaign-exclude-list.js";
import { mockResolveAccount, mockWithDatabase } from "./testing/mock-helpers.js";

const MOCK_ENTRIES = [{ personId: 100 }, { personId: 200 }];

function mockRepo(entries = MOCK_ENTRIES) {
  vi.mocked(CampaignRepository).mockImplementation(function () {
    return {
      getExcludeList: vi.fn().mockReturnValue(entries),
    } as unknown as CampaignRepository;
  });
}

function setupSuccessPath() {
  mockResolveAccount();
  mockWithDatabase();
  mockRepo();
}

describe("handleCampaignExcludeList", () => {
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

  it("prints campaign-level exclude list", async () => {
    setupSuccessPath();

    await handleCampaignExcludeList(1, {});

    expect(process.exitCode).toBeUndefined();
    const output = getStdout();
    expect(output).toContain("Exclude list for campaign 1: 2 person(s)");
    expect(output).toContain("Person IDs: 100, 200");
  });

  it("prints action-level exclude list", async () => {
    setupSuccessPath();

    await handleCampaignExcludeList(1, { actionId: 10 });

    expect(process.exitCode).toBeUndefined();
    expect(getStdout()).toContain(
      "Exclude list for action 10 in campaign 1: 2 person(s)",
    );
  });

  it("does not print person IDs when list is empty", async () => {
    mockResolveAccount();
    mockWithDatabase();
    mockRepo([]);

    await handleCampaignExcludeList(1, {});

    const output = getStdout();
    expect(output).toContain("0 person(s)");
    expect(output).not.toContain("Person IDs:");
  });

  it("prints JSON with --json", async () => {
    setupSuccessPath();

    await handleCampaignExcludeList(1, { json: true });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout());
    expect(parsed.campaignId).toBe(1);
    expect(parsed.level).toBe("campaign");
    expect(parsed.count).toBe(2);
    expect(parsed.personIds).toEqual([100, 200]);
  });

  it("includes actionId in JSON when action-level", async () => {
    setupSuccessPath();

    await handleCampaignExcludeList(1, { actionId: 10, json: true });

    const parsed = JSON.parse(getStdout());
    expect(parsed.actionId).toBe(10);
    expect(parsed.level).toBe("action");
  });

  it("sets exitCode 1 when campaign not found", async () => {
    mockResolveAccount();
    mockWithDatabase();
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        getExcludeList: vi.fn().mockImplementation(() => {
          throw new CampaignNotFoundError(999);
        }),
      } as unknown as CampaignRepository;
    });

    await handleCampaignExcludeList(999, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("Campaign 999 not found.\n");
  });

  it("sets exitCode 1 when action not found", async () => {
    mockResolveAccount();
    mockWithDatabase();
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        getExcludeList: vi.fn().mockImplementation(() => {
          throw new ActionNotFoundError(99, 1);
        }),
      } as unknown as CampaignRepository;
    });

    await handleCampaignExcludeList(1, { actionId: 99 });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Action 99 not found in campaign 1.\n",
    );
  });

  it("sets exitCode 1 on ExcludeListNotFoundError", async () => {
    mockResolveAccount();
    mockWithDatabase();
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        getExcludeList: vi.fn().mockImplementation(() => {
          throw new ExcludeListNotFoundError("campaign", 1);
        }),
      } as unknown as CampaignRepository;
    });

    await handleCampaignExcludeList(1, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Exclude list not found for campaign 1\n",
    );
  });

  it("sets exitCode 1 when resolveAccount fails", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("timeout"));

    await handleCampaignExcludeList(1, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("timeout\n");
  });
});
