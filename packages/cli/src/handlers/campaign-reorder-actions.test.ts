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
  ActionNotFoundError,
  CampaignExecutionError,
  CampaignNotFoundError,
  CampaignService,
  InstanceNotRunningError,
  resolveAccount,
  withInstanceDatabase,
} from "@lhremote/core";

import { handleCampaignReorderActions } from "./campaign-reorder-actions.js";
import {
  mockResolveAccount,
  mockWithInstanceDatabase,
} from "./testing/mock-helpers.js";

const MOCK_REORDERED = [
  { id: 2, name: "Send Message", config: { actionType: "MessageToPerson" } },
  { id: 1, name: "Visit Profile", config: { actionType: "VisitAndExtract" } },
];

function mockCampaignService(reordered = MOCK_REORDERED) {
  vi.mocked(CampaignService).mockImplementation(function () {
    return {
      reorderActions: vi.fn().mockResolvedValue(reordered),
    } as unknown as CampaignService;
  });
}

function setupSuccessPath() {
  mockResolveAccount();
  mockWithInstanceDatabase();
  mockCampaignService();
}

describe("handleCampaignReorderActions", () => {
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

  it("reorders actions and prints confirmation", async () => {
    setupSuccessPath();

    await handleCampaignReorderActions(1, { actionIds: "2,1" });

    expect(process.exitCode).toBeUndefined();
    const output = getStdout();
    expect(output).toContain("Actions reordered in campaign 1.");
    expect(output).toContain('#2 "Send Message" (MessageToPerson)');
    expect(output).toContain('#1 "Visit Profile" (VisitAndExtract)');
  });

  it("prints JSON with --json", async () => {
    setupSuccessPath();

    await handleCampaignReorderActions(1, { actionIds: "2,1", json: true });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout());
    expect(parsed.success).toBe(true);
    expect(parsed.campaignId).toBe(1);
    expect(parsed.actions).toHaveLength(2);
  });

  it("sets exitCode 1 on invalid action ID", async () => {
    await handleCampaignReorderActions(1, { actionIds: "1,abc" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid action ID: "abc"'),
    );
  });

  it("sets exitCode 1 when campaign not found", async () => {
    mockResolveAccount();
    mockWithInstanceDatabase();
    vi.mocked(CampaignService).mockImplementation(function () {
      return {
        reorderActions: vi
          .fn()
          .mockRejectedValue(new CampaignNotFoundError(999)),
      } as unknown as CampaignService;
    });

    await handleCampaignReorderActions(999, { actionIds: "1,2" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("Campaign 999 not found.\n");
  });

  it("sets exitCode 1 when action not found", async () => {
    mockResolveAccount();
    mockWithInstanceDatabase();
    vi.mocked(CampaignService).mockImplementation(function () {
      return {
        reorderActions: vi
          .fn()
          .mockRejectedValue(new ActionNotFoundError(99, 1)),
      } as unknown as CampaignService;
    });

    await handleCampaignReorderActions(1, { actionIds: "99,1" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "One or more action IDs not found in campaign 1.\n",
    );
  });

  it("sets exitCode 1 on CampaignExecutionError", async () => {
    mockResolveAccount();
    mockWithInstanceDatabase();
    vi.mocked(CampaignService).mockImplementation(function () {
      return {
        reorderActions: vi
          .fn()
          .mockRejectedValue(new CampaignExecutionError("count mismatch")),
      } as unknown as CampaignService;
    });

    await handleCampaignReorderActions(1, { actionIds: "1" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Failed to reorder actions: count mismatch\n",
    );
  });

  it("sets exitCode 1 on InstanceNotRunningError", async () => {
    mockResolveAccount();
    vi.mocked(withInstanceDatabase).mockRejectedValue(
      new InstanceNotRunningError("No LinkedHelper instance is running."),
    );

    await handleCampaignReorderActions(1, { actionIds: "1,2" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "No LinkedHelper instance is running.\n",
    );
  });

  it("sets exitCode 1 when resolveAccount fails", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("timeout"));

    await handleCampaignReorderActions(1, { actionIds: "1,2" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("timeout\n");
  });
});
