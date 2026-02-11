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
  ActionNotFoundError,
  CampaignNotFoundError,
  CampaignRepository,
  resolveAccount,
} from "@lhremote/core";

import { handleCampaignStatistics } from "./campaign-statistics.js";
import { mockResolveAccount, mockWithDatabase } from "./testing/mock-helpers.js";

const MOCK_ACTION = {
  actionId: 1,
  actionName: "Visit Profile",
  actionType: "VisitAndExtract",
  successful: 80,
  replied: 10,
  failed: 5,
  skipped: 5,
  total: 100,
  successRate: 80,
  firstResultAt: "2025-01-01T00:00:00Z",
  lastResultAt: "2025-01-15T00:00:00Z",
  topErrors: [
    {
      code: 429,
      count: 3,
      whoToBlame: "linkedin",
      isException: false,
    },
  ],
};

const MOCK_STATISTICS = {
  totals: {
    successful: 80,
    replied: 10,
    failed: 5,
    skipped: 5,
    total: 100,
    successRate: 80,
  },
  actions: [MOCK_ACTION],
};

function mockRepo(statistics = MOCK_STATISTICS) {
  const getStatistics = vi.fn().mockReturnValue(statistics);
  vi.mocked(CampaignRepository).mockImplementation(function () {
    return { getStatistics } as unknown as CampaignRepository;
  });
  return { getStatistics };
}

function setupSuccessPath() {
  mockResolveAccount();
  mockWithDatabase();
  return mockRepo();
}

describe("handleCampaignStatistics", () => {
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

  it("prints human-readable statistics", async () => {
    setupSuccessPath();

    await handleCampaignStatistics(1, {});

    expect(process.exitCode).toBeUndefined();
    const output = getStdout();
    expect(output).toContain("Campaign #1 Statistics");
    expect(output).toContain("80 successful");
    expect(output).toContain("10 replied");
    expect(output).toContain("5 failed");
    expect(output).toContain("80% success rate");
    expect(output).toContain("Action #1 — Visit Profile (VisitAndExtract)");
    expect(output).toContain("Timeline: 2025-01-01");
    expect(output).toContain("Code 429: 3x — blame: linkedin");
  });

  it("prints JSON with --json", async () => {
    setupSuccessPath();

    await handleCampaignStatistics(1, { json: true });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout());
    expect(parsed.totals.successful).toBe(80);
    expect(parsed.actions).toHaveLength(1);
  });

  it("passes actionId and maxErrors options", async () => {
    const { getStatistics } = setupSuccessPath();

    await handleCampaignStatistics(1, { actionId: 5, maxErrors: 3 });

    expect(getStatistics).toHaveBeenCalledWith(1, {
      actionId: 5,
      maxErrors: 3,
    });
  });

  it("omits timeline when firstResultAt is null", async () => {
    mockResolveAccount();
    mockWithDatabase();
    mockRepo({
      ...MOCK_STATISTICS,
      actions: [
        {
          ...MOCK_ACTION,
          firstResultAt: null as unknown as string,
          lastResultAt: null as unknown as string,
          topErrors: [],
        },
      ],
    });

    await handleCampaignStatistics(1, {});

    expect(getStdout()).not.toContain("Timeline:");
  });

  it("shows exception label for exception errors", async () => {
    mockResolveAccount();
    mockWithDatabase();
    mockRepo({
      ...MOCK_STATISTICS,
      actions: [
        {
          ...MOCK_ACTION,
          topErrors: [
            { code: 500, count: 1, whoToBlame: "system", isException: true },
          ],
        },
      ],
    });

    await handleCampaignStatistics(1, {});

    expect(getStdout()).toContain("(exception)");
  });

  it("sets exitCode 1 when campaign not found", async () => {
    mockResolveAccount();
    mockWithDatabase();
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        getStatistics: vi.fn().mockImplementation(() => {
          throw new CampaignNotFoundError(999);
        }),
      } as unknown as CampaignRepository;
    });

    await handleCampaignStatistics(999, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("Campaign 999 not found.\n");
  });

  it("sets exitCode 1 when action not found", async () => {
    mockResolveAccount();
    mockWithDatabase();
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        getStatistics: vi.fn().mockImplementation(() => {
          throw new ActionNotFoundError(99, 1);
        }),
      } as unknown as CampaignRepository;
    });

    await handleCampaignStatistics(1, { actionId: 99 });

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "Action 99 not found in campaign 1.\n",
    );
  });

  it("sets exitCode 1 when resolveAccount fails", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(new Error("timeout"));

    await handleCampaignStatistics(1, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("timeout\n");
  });
});
