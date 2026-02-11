import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    resolveAccount: vi.fn(),
    withInstanceDatabase: vi.fn(),
    CampaignService: vi.fn(),
    parseCampaignJson: vi.fn(),
    parseCampaignYaml: vi.fn(),
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
  CampaignFormatError,
  CampaignService,
  InstanceNotRunningError,
  parseCampaignJson,
  parseCampaignYaml,
  resolveAccount,
  withInstanceDatabase,
} from "@lhremote/core";
import { readFileSync } from "node:fs";

import { handleCampaignCreate } from "./campaign-create.js";
import {
  mockResolveAccount,
  mockWithInstanceDatabase,
} from "./testing/mock-helpers.js";

const MOCK_CONFIG = { name: "Test Campaign", actions: [] };
const MOCK_CAMPAIGN = { id: 1, name: "Test Campaign" };

function mockCampaignService(campaign = MOCK_CAMPAIGN) {
  vi.mocked(CampaignService).mockImplementation(function () {
    return {
      create: vi.fn().mockResolvedValue(campaign),
    } as unknown as CampaignService;
  });
}

function setupSuccessPath() {
  mockResolveAccount();
  mockWithInstanceDatabase();
  mockCampaignService();
  vi.mocked(parseCampaignJson).mockReturnValue(MOCK_CONFIG as never);
  vi.mocked(parseCampaignYaml).mockReturnValue(MOCK_CONFIG as never);
}

describe("handleCampaignCreate", () => {
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

  it("creates campaign from --json-input and prints result", async () => {
    setupSuccessPath();

    await handleCampaignCreate({ jsonInput: '{"name":"Test"}' });

    expect(process.exitCode).toBeUndefined();
    expect(getStdout()).toContain('Campaign created: #1 "Test Campaign"');
    expect(parseCampaignJson).toHaveBeenCalledWith('{"name":"Test"}');
  });

  it("creates campaign from --yaml", async () => {
    setupSuccessPath();

    await handleCampaignCreate({ yaml: "name: Test" });

    expect(process.exitCode).toBeUndefined();
    expect(parseCampaignYaml).toHaveBeenCalledWith("name: Test");
  });

  it("creates campaign from --file with JSON extension", async () => {
    setupSuccessPath();
    vi.mocked(readFileSync).mockReturnValue('{"name":"Test"}');

    await handleCampaignCreate({ file: "campaign.json" });

    expect(process.exitCode).toBeUndefined();
    expect(readFileSync).toHaveBeenCalledWith("campaign.json", "utf-8");
    expect(parseCampaignJson).toHaveBeenCalled();
  });

  it("creates campaign from --file with YAML extension", async () => {
    setupSuccessPath();
    vi.mocked(readFileSync).mockReturnValue("name: Test");

    await handleCampaignCreate({ file: "campaign.yaml" });

    expect(process.exitCode).toBeUndefined();
    expect(parseCampaignYaml).toHaveBeenCalled();
  });

  it("prints JSON with --json", async () => {
    setupSuccessPath();

    await handleCampaignCreate({ jsonInput: '{"name":"Test"}', json: true });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout());
    expect(parsed.id).toBe(1);
    expect(parsed.name).toBe("Test Campaign");
  });

  it("sets exitCode 1 when no input option provided", async () => {
    await handleCampaignCreate({});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "One of --file, --yaml, or --json-input is required.\n",
    );
  });

  it("sets exitCode 1 when multiple input options provided", async () => {
    await handleCampaignCreate({ yaml: "x", jsonInput: "y" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Use only one of --file, --yaml, or --json-input.\n",
    );
  });

  it("sets exitCode 1 on CampaignFormatError", async () => {
    mockResolveAccount();
    vi.mocked(parseCampaignJson).mockImplementation(() => {
      throw new CampaignFormatError("missing name");
    });

    await handleCampaignCreate({ jsonInput: "{}" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Invalid campaign configuration: missing name\n",
    );
  });

  it("sets exitCode 1 on parse error", async () => {
    mockResolveAccount();
    vi.mocked(parseCampaignJson).mockImplementation(() => {
      throw new SyntaxError("Unexpected token");
    });

    await handleCampaignCreate({ jsonInput: "bad" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to parse campaign configuration"),
    );
  });

  it("sets exitCode 1 when resolveAccount fails", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(
      new Error("No accounts found."),
    );
    vi.mocked(parseCampaignJson).mockReturnValue(MOCK_CONFIG as never);

    await handleCampaignCreate({ jsonInput: '{"name":"Test"}' });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("No accounts found.\n");
  });

  it("sets exitCode 1 on CampaignExecutionError", async () => {
    mockResolveAccount();
    mockWithInstanceDatabase();
    vi.mocked(parseCampaignJson).mockReturnValue(MOCK_CONFIG as never);
    vi.mocked(CampaignService).mockImplementation(function () {
      return {
        create: vi.fn().mockRejectedValue(
          new CampaignExecutionError("duplicate name"),
        ),
      } as unknown as CampaignService;
    });

    await handleCampaignCreate({ jsonInput: '{"name":"Test"}' });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Failed to create campaign: duplicate name\n",
    );
  });

  it("sets exitCode 1 on InstanceNotRunningError", async () => {
    mockResolveAccount();
    vi.mocked(parseCampaignJson).mockReturnValue(MOCK_CONFIG as never);
    vi.mocked(withInstanceDatabase).mockRejectedValue(
      new InstanceNotRunningError("No LinkedHelper instance is running."),
    );

    await handleCampaignCreate({ jsonInput: '{"name":"Test"}' });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "No LinkedHelper instance is running.\n",
    );
  });
});
