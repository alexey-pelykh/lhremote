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

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: vi.fn(),
  };
});

import {
  ActionNotFoundError,
  CampaignNotFoundError,
  CampaignRepository,
  ExcludeListNotFoundError,
  resolveAccount,
} from "@lhremote/core";
import { readFileSync } from "node:fs";

import { handleCampaignExcludeAdd } from "./campaign-exclude-add.js";
import { mockResolveAccount, mockWithDatabase } from "./testing/mock-helpers.js";

function mockRepo(added = 2) {
  const addToExcludeList = vi.fn().mockReturnValue(added);
  vi.mocked(CampaignRepository).mockImplementation(function () {
    return { addToExcludeList } as unknown as CampaignRepository;
  });
  return { addToExcludeList };
}

function setupSuccessPath() {
  mockResolveAccount();
  mockWithDatabase();
  return mockRepo();
}

describe("handleCampaignExcludeAdd", () => {
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

  it("adds persons to campaign-level exclude list", async () => {
    setupSuccessPath();

    await handleCampaignExcludeAdd(1, { personIds: "100,200" });

    expect(process.exitCode).toBeUndefined();
    expect(getStdout()).toContain(
      "Added 2 person(s) to exclude list for campaign 1.",
    );
  });

  it("adds persons to action-level exclude list", async () => {
    setupSuccessPath();

    await handleCampaignExcludeAdd(1, { personIds: "100,200", actionId: 10 });

    expect(process.exitCode).toBeUndefined();
    expect(getStdout()).toContain(
      "Added 2 person(s) to exclude list for action 10 in campaign 1.",
    );
  });

  it("shows already-excluded count", async () => {
    mockResolveAccount();
    mockWithDatabase();
    mockRepo(1); // only 1 of 2 actually added

    await handleCampaignExcludeAdd(1, { personIds: "100,200" });

    const output = getStdout();
    expect(output).toContain("Added 1 person(s)");
    expect(output).toContain("1 person(s) already in exclude list.");
  });

  it("reads from --person-ids-file", async () => {
    setupSuccessPath();
    vi.mocked(readFileSync).mockReturnValue("100\n200\n300");

    await handleCampaignExcludeAdd(1, { personIdsFile: "ids.txt" });

    expect(process.exitCode).toBeUndefined();
  });

  it("prints JSON with --json", async () => {
    setupSuccessPath();

    await handleCampaignExcludeAdd(1, { personIds: "100,200", json: true });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout());
    expect(parsed.success).toBe(true);
    expect(parsed.campaignId).toBe(1);
    expect(parsed.level).toBe("campaign");
    expect(parsed.added).toBe(2);
    expect(parsed.alreadyExcluded).toBe(0);
  });

  it("includes actionId in JSON when action-level", async () => {
    setupSuccessPath();

    await handleCampaignExcludeAdd(1, {
      personIds: "100",
      actionId: 10,
      json: true,
    });

    const parsed = JSON.parse(getStdout());
    expect(parsed.actionId).toBe(10);
    expect(parsed.level).toBe("action");
  });

  it("sets exitCode 1 when both person-ids options provided", async () => {
    await handleCampaignExcludeAdd(1, {
      personIds: "100",
      personIdsFile: "ids.txt",
    });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Use only one of --person-ids or --person-ids-file.\n",
    );
  });

  it("sets exitCode 1 when no person-ids option provided", async () => {
    await handleCampaignExcludeAdd(1, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Either --person-ids or --person-ids-file is required.\n",
    );
  });

  it("sets exitCode 1 when person IDs are empty", async () => {
    vi.mocked(readFileSync).mockReturnValue("");

    await handleCampaignExcludeAdd(1, { personIdsFile: "empty.txt" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("No person IDs provided.\n");
  });

  it("sets exitCode 1 when campaign not found", async () => {
    mockResolveAccount();
    mockWithDatabase();
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        addToExcludeList: vi.fn().mockImplementation(() => {
          throw new CampaignNotFoundError(999);
        }),
      } as unknown as CampaignRepository;
    });

    await handleCampaignExcludeAdd(999, { personIds: "100" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("Campaign 999 not found.\n");
  });

  it("sets exitCode 1 when action not found", async () => {
    mockResolveAccount();
    mockWithDatabase();
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        addToExcludeList: vi.fn().mockImplementation(() => {
          throw new ActionNotFoundError(99, 1);
        }),
      } as unknown as CampaignRepository;
    });

    await handleCampaignExcludeAdd(1, { personIds: "100", actionId: 99 });

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
        addToExcludeList: vi.fn().mockImplementation(() => {
          throw new ExcludeListNotFoundError("campaign", 1);
        }),
      } as unknown as CampaignRepository;
    });

    await handleCampaignExcludeAdd(1, { personIds: "100" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Exclude list not found for campaign 1\n",
    );
  });

  it("sets exitCode 1 when resolveAccount fails", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("timeout"));

    await handleCampaignExcludeAdd(1, { personIds: "100" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("timeout\n");
  });
});
