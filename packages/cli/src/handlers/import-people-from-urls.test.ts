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
  InstanceNotRunningError,
  resolveAccount,
  withInstanceDatabase,
} from "@lhremote/core";
import { readFileSync } from "node:fs";

import { handleImportPeopleFromUrls } from "./import-people-from-urls.js";
import {
  mockResolveAccount,
  mockWithInstanceDatabase,
} from "./testing/mock-helpers.js";

const MOCK_RESULT = {
  actionId: 10,
  successful: 3,
  alreadyInQueue: 1,
  alreadyProcessed: 0,
  failed: 0,
};

function mockCampaignService(result = MOCK_RESULT) {
  vi.mocked(CampaignService).mockImplementation(function () {
    return {
      importPeopleFromUrls: vi.fn().mockResolvedValue(result),
    } as unknown as CampaignService;
  });
}

function setupSuccessPath() {
  mockResolveAccount();
  mockWithInstanceDatabase();
  mockCampaignService();
}

describe("handleImportPeopleFromUrls", () => {
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

  it("imports people from --urls and prints result", async () => {
    setupSuccessPath();

    await handleImportPeopleFromUrls(1, {
      urls: "https://linkedin.com/in/alice,https://linkedin.com/in/bob",
    });

    expect(process.exitCode).toBeUndefined();
    const output = getStdout();
    expect(output).toContain("Imported 3 people into campaign 1 action 10.");
    expect(output).toContain("1 already in queue.");
  });

  it("imports from --urls-file", async () => {
    setupSuccessPath();
    vi.mocked(readFileSync).mockReturnValue(
      "https://linkedin.com/in/alice\nhttps://linkedin.com/in/bob",
    );

    await handleImportPeopleFromUrls(1, { urlsFile: "urls.txt" });

    expect(process.exitCode).toBeUndefined();
    expect(getStdout()).toContain("Imported 3 people");
  });

  it("prints JSON with --json", async () => {
    setupSuccessPath();

    await handleImportPeopleFromUrls(1, {
      urls: "https://linkedin.com/in/alice",
      json: true,
    });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout());
    expect(parsed.success).toBe(true);
    expect(parsed.campaignId).toBe(1);
    expect(parsed.actionId).toBe(10);
    expect(parsed.imported).toBe(3);
    expect(parsed.alreadyInQueue).toBe(1);
  });

  it("shows already-processed and failed counts when non-zero", async () => {
    mockResolveAccount();
    mockWithInstanceDatabase();
    mockCampaignService({
      actionId: 10,
      successful: 1,
      alreadyInQueue: 0,
      alreadyProcessed: 2,
      failed: 1,
    });

    await handleImportPeopleFromUrls(1, {
      urls: "https://linkedin.com/in/alice",
    });

    const output = getStdout();
    expect(output).toContain("2 already processed.");
    expect(output).toContain("1 failed.");
  });

  it("omits zero counts from human output", async () => {
    mockResolveAccount();
    mockWithInstanceDatabase();
    mockCampaignService({
      actionId: 10,
      successful: 3,
      alreadyInQueue: 0,
      alreadyProcessed: 0,
      failed: 0,
    });

    await handleImportPeopleFromUrls(1, {
      urls: "https://linkedin.com/in/alice",
    });

    const output = getStdout();
    expect(output).not.toContain("already in queue");
    expect(output).not.toContain("already processed");
    expect(output).not.toContain("failed");
  });

  it("sets exitCode 1 when both url options provided", async () => {
    await handleImportPeopleFromUrls(1, {
      urls: "https://linkedin.com/in/alice",
      urlsFile: "urls.txt",
    });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Use only one of --urls or --urls-file.\n",
    );
  });

  it("sets exitCode 1 when no url option provided", async () => {
    await handleImportPeopleFromUrls(1, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Either --urls or --urls-file is required.\n",
    );
  });

  it("sets exitCode 1 when URLs are empty", async () => {
    vi.mocked(readFileSync).mockReturnValue("");

    await handleImportPeopleFromUrls(1, { urlsFile: "empty.txt" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("No URLs provided.\n");
  });

  it("sets exitCode 1 when campaign not found", async () => {
    mockResolveAccount();
    mockWithInstanceDatabase();
    vi.mocked(CampaignService).mockImplementation(function () {
      return {
        importPeopleFromUrls: vi
          .fn()
          .mockRejectedValue(new CampaignNotFoundError(999)),
      } as unknown as CampaignService;
    });

    await handleImportPeopleFromUrls(999, {
      urls: "https://linkedin.com/in/alice",
    });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("Campaign 999 not found.\n");
  });

  it("sets exitCode 1 on CampaignExecutionError", async () => {
    mockResolveAccount();
    mockWithInstanceDatabase();
    vi.mocked(CampaignService).mockImplementation(function () {
      return {
        importPeopleFromUrls: vi
          .fn()
          .mockRejectedValue(new CampaignExecutionError("import failed")),
      } as unknown as CampaignService;
    });

    await handleImportPeopleFromUrls(1, {
      urls: "https://linkedin.com/in/alice",
    });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Failed to import people: import failed\n",
    );
  });

  it("sets exitCode 1 on InstanceNotRunningError", async () => {
    mockResolveAccount();
    vi.mocked(withInstanceDatabase).mockRejectedValue(
      new InstanceNotRunningError("No LinkedHelper instance is running."),
    );

    await handleImportPeopleFromUrls(1, {
      urls: "https://linkedin.com/in/alice",
    });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "No LinkedHelper instance is running.\n",
    );
  });

  it("sets exitCode 1 when resolveAccount fails", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("timeout"));

    await handleImportPeopleFromUrls(1, {
      urls: "https://linkedin.com/in/alice",
    });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("timeout\n");
  });

  it("sets exitCode 1 when urls-file read fails", async () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error("ENOENT: no such file");
    });

    await handleImportPeopleFromUrls(1, { urlsFile: "missing.txt" });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("ENOENT"),
    );
  });
});
