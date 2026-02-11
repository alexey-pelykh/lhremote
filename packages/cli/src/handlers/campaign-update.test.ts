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

import { handleCampaignUpdate } from "./campaign-update.js";
import { mockResolveAccount, mockWithDatabase } from "./testing/mock-helpers.js";

const MOCK_UPDATED = { id: 1, name: "Updated Name" };

function mockRepo(updated = MOCK_UPDATED) {
  const updateCampaign = vi.fn().mockReturnValue(updated);
  vi.mocked(CampaignRepository).mockImplementation(function () {
    return { updateCampaign } as unknown as CampaignRepository;
  });
  return { updateCampaign };
}

function setupSuccessPath() {
  mockResolveAccount();
  mockWithDatabase();
  return mockRepo();
}

describe("handleCampaignUpdate", () => {
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

  it("updates campaign name and prints confirmation", async () => {
    setupSuccessPath();

    await handleCampaignUpdate(1, { name: "Updated Name" });

    expect(process.exitCode).toBeUndefined();
    expect(getStdout()).toContain('Campaign updated: #1 "Updated Name"');
  });

  it("prints JSON with --json", async () => {
    setupSuccessPath();

    await handleCampaignUpdate(1, { name: "Updated Name", json: true });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout());
    expect(parsed.id).toBe(1);
    expect(parsed.name).toBe("Updated Name");
  });

  it("passes name update to repository", async () => {
    const { updateCampaign } = setupSuccessPath();

    await handleCampaignUpdate(1, { name: "New Name" });

    expect(updateCampaign).toHaveBeenCalledWith(1, { name: "New Name" });
  });

  it("passes description update to repository", async () => {
    const { updateCampaign } = setupSuccessPath();

    await handleCampaignUpdate(1, { description: "New desc" });

    expect(updateCampaign).toHaveBeenCalledWith(1, {
      description: "New desc",
    });
  });

  it("passes null description when --clear-description", async () => {
    const { updateCampaign } = setupSuccessPath();

    await handleCampaignUpdate(1, { clearDescription: true });

    expect(updateCampaign).toHaveBeenCalledWith(1, { description: null });
  });

  it("sets exitCode 1 when no update options provided", async () => {
    await handleCampaignUpdate(1, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "At least one of --name, --description, or --clear-description is required.\n",
    );
  });

  it("sets exitCode 1 when campaign not found", async () => {
    mockResolveAccount();
    mockWithDatabase();
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        updateCampaign: vi.fn().mockImplementation(() => {
          throw new CampaignNotFoundError(999);
        }),
      } as unknown as CampaignRepository;
    });

    await handleCampaignUpdate(999, { name: "x" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("Campaign 999 not found.\n");
  });

  it("sets exitCode 1 when resolveAccount fails", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("timeout"));

    await handleCampaignUpdate(1, { name: "x" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("timeout\n");
  });
});
