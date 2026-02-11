import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    resolveAccount: vi.fn(),
    withInstanceDatabase: vi.fn(),
    CampaignService: vi.fn(),
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
  CampaignExecutionError,
  CampaignNotFoundError,
  CampaignService,
  CampaignTimeoutError,
  InstanceNotRunningError,
  resolveAccount,
  withInstanceDatabase,
} from "@lhremote/core";
import { readFileSync } from "node:fs";

import { handleCampaignStart } from "./campaign-start.js";
import {
  mockResolveAccount,
  mockWithInstanceDatabase,
} from "./testing/mock-helpers.js";

function mockCampaignService() {
  vi.mocked(CampaignService).mockImplementation(function () {
    return {
      start: vi.fn().mockResolvedValue(undefined),
    } as unknown as CampaignService;
  });
}

function setupSuccessPath() {
  mockResolveAccount();
  mockWithInstanceDatabase();
  mockCampaignService();
}

describe("handleCampaignStart", () => {
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

  it("starts campaign with --person-ids", async () => {
    setupSuccessPath();

    await handleCampaignStart(1, { personIds: "100,200,300" });

    expect(process.exitCode).toBeUndefined();
    expect(getStdout()).toContain("Campaign 1 started with 3 persons queued.");
  });

  it("starts campaign with --person-ids-file", async () => {
    setupSuccessPath();
    vi.mocked(readFileSync).mockReturnValue("100\n200\n300");

    await handleCampaignStart(1, { personIdsFile: "ids.txt" });

    expect(process.exitCode).toBeUndefined();
    expect(getStdout()).toContain("3 persons queued.");
  });

  it("prints JSON with --json", async () => {
    setupSuccessPath();

    await handleCampaignStart(1, { personIds: "100", json: true });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout());
    expect(parsed.success).toBe(true);
    expect(parsed.campaignId).toBe(1);
    expect(parsed.personsQueued).toBe(1);
  });

  it("sets exitCode 1 when both person-ids options provided", async () => {
    await handleCampaignStart(1, {
      personIds: "100",
      personIdsFile: "ids.txt",
    });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Use only one of --person-ids or --person-ids-file.\n",
    );
  });

  it("sets exitCode 1 when no person-ids option provided", async () => {
    await handleCampaignStart(1, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Either --person-ids or --person-ids-file is required.\n",
    );
  });

  it("sets exitCode 1 when person IDs are empty", async () => {
    vi.mocked(readFileSync).mockReturnValue("");

    await handleCampaignStart(1, { personIdsFile: "empty.txt" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("No person IDs provided.\n");
  });

  it("sets exitCode 1 on invalid person ID", async () => {
    await handleCampaignStart(1, { personIds: "100,abc" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid person ID: "abc"'),
    );
  });

  it("sets exitCode 1 when campaign not found", async () => {
    mockResolveAccount();
    mockWithInstanceDatabase();
    vi.mocked(CampaignService).mockImplementation(function () {
      return {
        start: vi.fn().mockRejectedValue(new CampaignNotFoundError(999)),
      } as unknown as CampaignService;
    });

    await handleCampaignStart(999, { personIds: "100" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("Campaign 999 not found.\n");
  });

  it("sets exitCode 1 on CampaignTimeoutError", async () => {
    mockResolveAccount();
    mockWithInstanceDatabase();
    vi.mocked(CampaignService).mockImplementation(function () {
      return {
        start: vi.fn().mockRejectedValue(
          new CampaignTimeoutError("timed out after 60s"),
        ),
      } as unknown as CampaignService;
    });

    await handleCampaignStart(1, { personIds: "100" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Campaign start timed out: timed out after 60s\n",
    );
  });

  it("sets exitCode 1 on CampaignExecutionError", async () => {
    mockResolveAccount();
    mockWithInstanceDatabase();
    vi.mocked(CampaignService).mockImplementation(function () {
      return {
        start: vi.fn().mockRejectedValue(
          new CampaignExecutionError("execution failed"),
        ),
      } as unknown as CampaignService;
    });

    await handleCampaignStart(1, { personIds: "100" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Failed to start campaign: execution failed\n",
    );
  });

  it("sets exitCode 1 on InstanceNotRunningError", async () => {
    mockResolveAccount();
    vi.mocked(withInstanceDatabase).mockRejectedValue(
      new InstanceNotRunningError("No LinkedHelper instance is running."),
    );

    await handleCampaignStart(1, { personIds: "100" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "No LinkedHelper instance is running.\n",
    );
  });

  it("sets exitCode 1 when resolveAccount fails", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("timeout"));

    await handleCampaignStart(1, { personIds: "100" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("timeout\n");
  });
});
