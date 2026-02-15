// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    campaignExport: vi.fn(),
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
  type CampaignExportOutput,
  CampaignNotFoundError,
  campaignExport,
} from "@lhremote/core";
import { writeFileSync } from "node:fs";

import { handleCampaignExport } from "./campaign-export.js";
import { getStdout } from "./testing/mock-helpers.js";

const MOCK_YAML_RESULT: CampaignExportOutput = {
  campaignId: 1,
  format: "yaml",
  config: "name: Test Campaign\n",
};

const MOCK_JSON_RESULT: CampaignExportOutput = {
  campaignId: 1,
  format: "json",
  config: '{"name":"Test Campaign"}\n',
};

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

  it("exports campaign as YAML to stdout by default", async () => {
    vi.mocked(campaignExport).mockResolvedValue(MOCK_YAML_RESULT);

    await handleCampaignExport(1, {});

    expect(process.exitCode).toBeUndefined();
    expect(campaignExport).toHaveBeenCalledWith(
      expect.objectContaining({ format: "yaml" }),
    );
    expect(getStdout(stdoutSpy)).toContain("name: Test Campaign");
  });

  it("exports campaign as JSON when --format json", async () => {
    vi.mocked(campaignExport).mockResolvedValue(MOCK_JSON_RESULT);

    await handleCampaignExport(1, { format: "json" });

    expect(process.exitCode).toBeUndefined();
    expect(campaignExport).toHaveBeenCalledWith(
      expect.objectContaining({ format: "json" }),
    );
  });

  it("writes to file when --output specified", async () => {
    vi.mocked(campaignExport).mockResolvedValue(MOCK_YAML_RESULT);

    await handleCampaignExport(1, { output: "campaign.yaml" });

    expect(process.exitCode).toBeUndefined();
    expect(writeFileSync).toHaveBeenCalledWith(
      "campaign.yaml",
      "name: Test Campaign\n",
      "utf-8",
    );
    expect(getStdout(stdoutSpy)).toContain("Campaign 1 exported to campaign.yaml");
  });

  it("sets exitCode 1 on unsupported format", async () => {
    await handleCampaignExport(1, { format: "xml" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      'Unsupported format "xml". Use "yaml" or "json".\n',
    );
  });

  it("sets exitCode 1 when campaign not found", async () => {
    vi.mocked(campaignExport).mockRejectedValue(new CampaignNotFoundError(999));

    await handleCampaignExport(999, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("Campaign 999 not found.\n");
  });

  it("sets exitCode 1 when resolveAccount fails", async () => {
    vi.mocked(campaignExport).mockRejectedValue(new Error("timeout"));

    await handleCampaignExport(1, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("timeout\n");
  });
});
