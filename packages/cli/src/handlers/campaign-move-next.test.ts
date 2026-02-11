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
  NoNextActionError,
  resolveAccount,
} from "@lhremote/core";
import { readFileSync } from "node:fs";

import { handleCampaignMoveNext } from "./campaign-move-next.js";
import { mockResolveAccount, mockWithDatabase } from "./testing/mock-helpers.js";

function mockRepo(nextActionId = 11) {
  const moveToNextAction = vi.fn().mockReturnValue({ nextActionId });
  vi.mocked(CampaignRepository).mockImplementation(function () {
    return { moveToNextAction } as unknown as CampaignRepository;
  });
  return { moveToNextAction };
}

function setupSuccessPath() {
  mockResolveAccount();
  mockWithDatabase();
  return mockRepo();
}

describe("handleCampaignMoveNext", () => {
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

  it("moves persons to next action with --person-ids", async () => {
    setupSuccessPath();

    await handleCampaignMoveNext(1, 10, { personIds: "100,200" });

    expect(process.exitCode).toBeUndefined();
    expect(getStdout()).toContain(
      "Campaign 1: 2 persons moved from action 10 to action 11.",
    );
  });

  it("moves persons with --person-ids-file", async () => {
    setupSuccessPath();
    vi.mocked(readFileSync).mockReturnValue("100\n200\n300");

    await handleCampaignMoveNext(1, 10, { personIdsFile: "ids.txt" });

    expect(process.exitCode).toBeUndefined();
    expect(getStdout()).toContain("3 persons moved");
  });

  it("prints JSON with --json", async () => {
    setupSuccessPath();

    await handleCampaignMoveNext(1, 10, { personIds: "100", json: true });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout());
    expect(parsed.success).toBe(true);
    expect(parsed.campaignId).toBe(1);
    expect(parsed.fromActionId).toBe(10);
    expect(parsed.toActionId).toBe(11);
    expect(parsed.personsMoved).toBe(1);
  });

  it("passes person IDs to repository", async () => {
    const { moveToNextAction } = setupSuccessPath();

    await handleCampaignMoveNext(1, 10, { personIds: "100,200" });

    expect(moveToNextAction).toHaveBeenCalledWith(1, 10, [100, 200]);
  });

  it("sets exitCode 1 when both person-ids options provided", async () => {
    await handleCampaignMoveNext(1, 10, {
      personIds: "100",
      personIdsFile: "ids.txt",
    });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Use only one of --person-ids or --person-ids-file.\n",
    );
  });

  it("sets exitCode 1 when no person-ids option provided", async () => {
    await handleCampaignMoveNext(1, 10, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Either --person-ids or --person-ids-file is required.\n",
    );
  });

  it("sets exitCode 1 when person IDs are empty", async () => {
    vi.mocked(readFileSync).mockReturnValue("");

    await handleCampaignMoveNext(1, 10, { personIdsFile: "empty.txt" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("No person IDs provided.\n");
  });

  it("sets exitCode 1 on invalid person ID", async () => {
    await handleCampaignMoveNext(1, 10, { personIds: "100,abc" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid person ID: "abc"'),
    );
  });

  it("sets exitCode 1 when campaign not found", async () => {
    mockResolveAccount();
    mockWithDatabase();
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        moveToNextAction: vi.fn().mockImplementation(() => {
          throw new CampaignNotFoundError(999);
        }),
      } as unknown as CampaignRepository;
    });

    await handleCampaignMoveNext(999, 10, { personIds: "100" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("Campaign 999 not found.\n");
  });

  it("sets exitCode 1 when action not found", async () => {
    mockResolveAccount();
    mockWithDatabase();
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        moveToNextAction: vi.fn().mockImplementation(() => {
          throw new ActionNotFoundError(99, 1);
        }),
      } as unknown as CampaignRepository;
    });

    await handleCampaignMoveNext(1, 99, { personIds: "100" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Action 99 not found in campaign 1.\n",
    );
  });

  it("sets exitCode 1 when no next action", async () => {
    mockResolveAccount();
    mockWithDatabase();
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        moveToNextAction: vi.fn().mockImplementation(() => {
          throw new NoNextActionError(10, 1);
        }),
      } as unknown as CampaignRepository;
    });

    await handleCampaignMoveNext(1, 10, { personIds: "100" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Action 10 is the last action in campaign 1.\n",
    );
  });

  it("sets exitCode 1 when resolveAccount fails", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("timeout"));

    await handleCampaignMoveNext(1, 10, { personIds: "100" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("timeout\n");
  });
});
