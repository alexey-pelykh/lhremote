import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    resolveAccount: vi.fn(),
    withDatabase: vi.fn(),
    CampaignRepository: vi.fn(),
    serializeCampaignJson: vi.fn(),
    serializeCampaignYaml: vi.fn(),
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    writeFileSync: vi.fn(),
  };
});

import {
  CampaignNotFoundError,
  CampaignRepository,
  resolveAccount,
  serializeCampaignJson,
  serializeCampaignYaml,
} from "@lhremote/core";
import { writeFileSync } from "node:fs";

import { handleCampaignExport } from "./campaign-export.js";
import { mockResolveAccount, mockWithDatabase } from "./testing/mock-helpers.js";

const MOCK_CAMPAIGN = { id: 1, name: "Test Campaign" };
const MOCK_ACTIONS = [{ id: 10, name: "Visit" }];

function mockRepo(campaign = MOCK_CAMPAIGN, actions = MOCK_ACTIONS) {
  vi.mocked(CampaignRepository).mockImplementation(function () {
    return {
      getCampaign: vi.fn().mockReturnValue(campaign),
      getCampaignActions: vi.fn().mockReturnValue(actions),
    } as unknown as CampaignRepository;
  });
}

function setupSuccessPath() {
  mockResolveAccount();
  mockWithDatabase();
  mockRepo();
  vi.mocked(serializeCampaignYaml).mockReturnValue("name: Test Campaign\n");
  vi.mocked(serializeCampaignJson).mockReturnValue('{"name":"Test Campaign"}\n');
}

describe("handleCampaignExport", () => {
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

  it("exports campaign as YAML to stdout by default", async () => {
    setupSuccessPath();

    await handleCampaignExport(1, {});

    expect(process.exitCode).toBeUndefined();
    expect(serializeCampaignYaml).toHaveBeenCalled();
    expect(getStdout()).toContain("name: Test Campaign");
  });

  it("exports campaign as JSON when --format json", async () => {
    setupSuccessPath();

    await handleCampaignExport(1, { format: "json" });

    expect(process.exitCode).toBeUndefined();
    expect(serializeCampaignJson).toHaveBeenCalled();
  });

  it("writes to file when --output specified", async () => {
    setupSuccessPath();

    await handleCampaignExport(1, { output: "campaign.yaml" });

    expect(process.exitCode).toBeUndefined();
    expect(writeFileSync).toHaveBeenCalledWith(
      "campaign.yaml",
      "name: Test Campaign\n",
      "utf-8",
    );
    expect(getStdout()).toContain("Campaign 1 exported to campaign.yaml");
  });

  it("sets exitCode 1 on unsupported format", async () => {
    await handleCampaignExport(1, { format: "xml" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      'Unsupported format "xml". Use "yaml" or "json".\n',
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
        getCampaignActions: vi.fn(),
      } as unknown as CampaignRepository;
    });

    await handleCampaignExport(999, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("Campaign 999 not found.\n");
  });

  it("sets exitCode 1 when resolveAccount fails", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("timeout"));

    await handleCampaignExport(1, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("timeout\n");
  });
});
