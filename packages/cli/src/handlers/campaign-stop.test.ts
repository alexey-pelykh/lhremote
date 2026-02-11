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

import { handleCampaignStop } from "./campaign-stop.js";
import {
  mockResolveAccount,
  mockWithInstanceDatabase,
} from "./testing/mock-helpers.js";

function mockCampaignService() {
  vi.mocked(CampaignService).mockImplementation(function () {
    return {
      stop: vi.fn().mockResolvedValue(undefined),
    } as unknown as CampaignService;
  });
}

function setupSuccessPath() {
  mockResolveAccount();
  mockWithInstanceDatabase();
  mockCampaignService();
}

describe("handleCampaignStop", () => {
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

  it("pauses campaign and prints confirmation", async () => {
    setupSuccessPath();

    await handleCampaignStop(5, {});

    expect(process.exitCode).toBeUndefined();
    expect(getStdout()).toContain("Campaign 5 paused.");
  });

  it("prints JSON with --json", async () => {
    setupSuccessPath();

    await handleCampaignStop(5, { json: true });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout());
    expect(parsed.success).toBe(true);
    expect(parsed.campaignId).toBe(5);
    expect(parsed.message).toBe("Campaign paused");
  });

  it("sets exitCode 1 when campaign not found", async () => {
    mockResolveAccount();
    mockWithInstanceDatabase();
    vi.mocked(CampaignService).mockImplementation(function () {
      return {
        stop: vi.fn().mockRejectedValue(new CampaignNotFoundError(999)),
      } as unknown as CampaignService;
    });

    await handleCampaignStop(999, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("Campaign 999 not found.\n");
  });

  it("sets exitCode 1 on CampaignExecutionError", async () => {
    mockResolveAccount();
    mockWithInstanceDatabase();
    vi.mocked(CampaignService).mockImplementation(function () {
      return {
        stop: vi.fn().mockRejectedValue(
          new CampaignExecutionError("already stopped"),
        ),
      } as unknown as CampaignService;
    });

    await handleCampaignStop(5, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Failed to stop campaign: already stopped\n",
    );
  });

  it("sets exitCode 1 on InstanceNotRunningError", async () => {
    mockResolveAccount();
    vi.mocked(withInstanceDatabase).mockRejectedValue(
      new InstanceNotRunningError("No LinkedHelper instance is running."),
    );

    await handleCampaignStop(5, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "No LinkedHelper instance is running.\n",
    );
  });

  it("sets exitCode 1 when resolveAccount fails", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("timeout"));

    await handleCampaignStop(5, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("timeout\n");
  });
});
