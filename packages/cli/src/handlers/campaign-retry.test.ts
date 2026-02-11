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
  CampaignNotFoundError,
  CampaignRepository,
  resolveAccount,
} from "@lhremote/core";
import { readFileSync } from "node:fs";

import { handleCampaignRetry } from "./campaign-retry.js";
import { mockResolveAccount, mockWithDatabase } from "./testing/mock-helpers.js";

function mockRepo() {
  const resetForRerun = vi.fn();
  vi.mocked(CampaignRepository).mockImplementation(function () {
    return { resetForRerun } as unknown as CampaignRepository;
  });
  return { resetForRerun };
}

function setupSuccessPath() {
  mockResolveAccount();
  mockWithDatabase();
  return mockRepo();
}

describe("handleCampaignRetry", () => {
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

  it("resets persons for retry with --person-ids", async () => {
    setupSuccessPath();

    await handleCampaignRetry(1, { personIds: "100,200" });

    expect(process.exitCode).toBeUndefined();
    expect(getStdout()).toContain("Campaign 1: 2 persons reset for retry.");
  });

  it("resets persons for retry with --person-ids-file", async () => {
    setupSuccessPath();
    vi.mocked(readFileSync).mockReturnValue("100\n200\n300");

    await handleCampaignRetry(1, { personIdsFile: "ids.txt" });

    expect(process.exitCode).toBeUndefined();
    expect(getStdout()).toContain("3 persons reset for retry.");
  });

  it("prints JSON with --json", async () => {
    setupSuccessPath();

    await handleCampaignRetry(1, { personIds: "100", json: true });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout());
    expect(parsed.success).toBe(true);
    expect(parsed.campaignId).toBe(1);
    expect(parsed.personsReset).toBe(1);
  });

  it("passes person IDs to repository", async () => {
    const { resetForRerun } = setupSuccessPath();

    await handleCampaignRetry(1, { personIds: "100,200" });

    expect(resetForRerun).toHaveBeenCalledWith(1, [100, 200]);
  });

  it("sets exitCode 1 when both person-ids options provided", async () => {
    await handleCampaignRetry(1, {
      personIds: "100",
      personIdsFile: "ids.txt",
    });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Use only one of --person-ids or --person-ids-file.\n",
    );
  });

  it("sets exitCode 1 when no person-ids option provided", async () => {
    await handleCampaignRetry(1, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Either --person-ids or --person-ids-file is required.\n",
    );
  });

  it("sets exitCode 1 when person IDs are empty", async () => {
    vi.mocked(readFileSync).mockReturnValue("");

    await handleCampaignRetry(1, { personIdsFile: "empty.txt" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("No person IDs provided.\n");
  });

  it("sets exitCode 1 on invalid person ID", async () => {
    await handleCampaignRetry(1, { personIds: "100,abc" });

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
        resetForRerun: vi.fn().mockImplementation(() => {
          throw new CampaignNotFoundError(999);
        }),
      } as unknown as CampaignRepository;
    });

    await handleCampaignRetry(999, { personIds: "100" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("Campaign 999 not found.\n");
  });

  it("sets exitCode 1 when resolveAccount fails", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("timeout"));

    await handleCampaignRetry(1, { personIds: "100" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("timeout\n");
  });
});
