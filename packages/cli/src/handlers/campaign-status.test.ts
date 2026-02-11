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

import {
  CampaignExecutionError,
  CampaignNotFoundError,
  CampaignService,
  InstanceNotRunningError,
  resolveAccount,
  withInstanceDatabase,
} from "@lhremote/core";

import { handleCampaignStatus } from "./campaign-status.js";
import {
  mockResolveAccount,
  mockWithInstanceDatabase,
} from "./testing/mock-helpers.js";

const MOCK_STATUS = {
  campaignState: "running",
  isPaused: false,
  runnerState: "active",
  actionCounts: [
    { actionId: 1, queued: 10, processed: 5, successful: 4, failed: 1 },
  ],
};

const MOCK_RESULTS = {
  results: [
    { personId: 100, result: "success", actionVersionId: 1 },
    { personId: 101, result: "failed", actionVersionId: 1 },
  ],
};

function mockCampaignService(
  status = MOCK_STATUS,
  results = MOCK_RESULTS,
) {
  vi.mocked(CampaignService).mockImplementation(function () {
    return {
      getStatus: vi.fn().mockResolvedValue(status),
      getResults: vi.fn().mockResolvedValue(results),
    } as unknown as CampaignService;
  });
}

function setupSuccessPath() {
  mockResolveAccount();
  mockWithInstanceDatabase();
  mockCampaignService();
}

describe("handleCampaignStatus", () => {
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

  it("prints human-readable status", async () => {
    setupSuccessPath();

    await handleCampaignStatus(1, {});

    expect(process.exitCode).toBeUndefined();
    const output = getStdout();
    expect(output).toContain("Campaign #1 Status");
    expect(output).toContain("State: running");
    expect(output).toContain("Paused: no");
    expect(output).toContain("Runner: active");
    expect(output).toContain("Action #1: 10 queued, 5 processed, 4 successful, 1 failed");
  });

  it("prints JSON with --json", async () => {
    setupSuccessPath();

    await handleCampaignStatus(1, { json: true });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout());
    expect(parsed.campaignId).toBe(1);
    expect(parsed.campaignState).toBe("running");
    expect(parsed.actionCounts).toHaveLength(1);
  });

  it("includes results with --include-results", async () => {
    setupSuccessPath();

    await handleCampaignStatus(1, { includeResults: true });

    expect(process.exitCode).toBeUndefined();
    const output = getStdout();
    expect(output).toContain("Results (2):");
    expect(output).toContain("Person 100: result=success");
    expect(output).toContain("Person 101: result=failed");
  });

  it("includes results in JSON with --include-results --json", async () => {
    setupSuccessPath();

    await handleCampaignStatus(1, { includeResults: true, json: true });

    const parsed = JSON.parse(getStdout());
    expect(parsed.results).toHaveLength(2);
  });

  it("prints 'No results yet' when results empty", async () => {
    mockResolveAccount();
    mockWithInstanceDatabase();
    mockCampaignService(MOCK_STATUS, { results: [] });

    await handleCampaignStatus(1, { includeResults: true });

    expect(getStdout()).toContain("No results yet.");
  });

  it("omits action counts section when empty", async () => {
    mockResolveAccount();
    mockWithInstanceDatabase();
    mockCampaignService({ ...MOCK_STATUS, actionCounts: [] });

    await handleCampaignStatus(1, {});

    expect(getStdout()).not.toContain("Action Counts:");
  });

  it("sets exitCode 1 when campaign not found", async () => {
    mockResolveAccount();
    mockWithInstanceDatabase();
    vi.mocked(CampaignService).mockImplementation(function () {
      return {
        getStatus: vi.fn().mockRejectedValue(new CampaignNotFoundError(999)),
      } as unknown as CampaignService;
    });

    await handleCampaignStatus(999, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("Campaign 999 not found.\n");
  });

  it("sets exitCode 1 on CampaignExecutionError", async () => {
    mockResolveAccount();
    mockWithInstanceDatabase();
    vi.mocked(CampaignService).mockImplementation(function () {
      return {
        getStatus: vi.fn().mockRejectedValue(
          new CampaignExecutionError("status unavailable"),
        ),
      } as unknown as CampaignService;
    });

    await handleCampaignStatus(1, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Failed to get campaign status: status unavailable\n",
    );
  });

  it("sets exitCode 1 on InstanceNotRunningError", async () => {
    mockResolveAccount();
    vi.mocked(withInstanceDatabase).mockRejectedValue(
      new InstanceNotRunningError("No LinkedHelper instance is running."),
    );

    await handleCampaignStatus(1, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "No LinkedHelper instance is running.\n",
    );
  });

  it("sets exitCode 1 when resolveAccount fails", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("timeout"));

    await handleCampaignStatus(1, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("timeout\n");
  });
});
