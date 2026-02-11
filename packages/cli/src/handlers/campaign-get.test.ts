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

import { handleCampaignGet } from "./campaign-get.js";
import { mockResolveAccount, mockWithDatabase } from "./testing/mock-helpers.js";

const MOCK_CAMPAIGN = {
  id: 1,
  name: "Outreach Q1",
  state: "running",
  isPaused: false,
  isArchived: false,
  description: "Q1 outreach campaign",
  createdAt: "2025-01-01T00:00:00Z",
  liAccountId: 42,
};

const MOCK_ACTIONS = [
  {
    id: 10,
    name: "Visit Profile",
    config: { actionType: "VisitAndExtract" },
  },
  {
    id: 11,
    name: "Send Message",
    config: { actionType: "MessageToPerson" },
  },
];

function mockRepo(
  campaign = MOCK_CAMPAIGN,
  actions = MOCK_ACTIONS,
) {
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
}

describe("handleCampaignGet", () => {
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

  it("prints JSON with --json", async () => {
    setupSuccessPath();

    await handleCampaignGet(1, { json: true });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout());
    expect(parsed.id).toBe(1);
    expect(parsed.name).toBe("Outreach Q1");
    expect(parsed.actions).toHaveLength(2);
  });

  it("prints human-readable output", async () => {
    setupSuccessPath();

    await handleCampaignGet(1, {});

    expect(process.exitCode).toBeUndefined();
    const output = getStdout();
    expect(output).toContain("Campaign #1: Outreach Q1");
    expect(output).toContain("State: running");
    expect(output).toContain("Paused: no");
    expect(output).toContain("Archived: no");
    expect(output).toContain("Description: Q1 outreach campaign");
    expect(output).toContain("Actions (2):");
    expect(output).toContain("#10  Visit Profile [VisitAndExtract]");
    expect(output).toContain("#11  Send Message [MessageToPerson]");
  });

  it("omits description when absent", async () => {
    mockResolveAccount();
    mockWithDatabase();
    mockRepo({ ...MOCK_CAMPAIGN, description: null as unknown as string }, []);

    await handleCampaignGet(1, {});

    const output = getStdout();
    expect(output).not.toContain("Description:");
  });

  it("omits actions section when empty", async () => {
    mockResolveAccount();
    mockWithDatabase();
    mockRepo(MOCK_CAMPAIGN, []);

    await handleCampaignGet(1, {});

    const output = getStdout();
    expect(output).not.toContain("Actions");
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

    await handleCampaignGet(999, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("Campaign 999 not found.\n");
  });

  it("sets exitCode 1 when resolveAccount fails", async () => {
    vi.mocked(resolveAccount).mockRejectedValue(
      new Error("No accounts found."),
    );

    await handleCampaignGet(1, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("No accounts found.\n");
  });

  it("sets exitCode 1 on unexpected error", async () => {
    mockResolveAccount();
    mockWithDatabase();
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        getCampaign: vi.fn().mockImplementation(() => {
          throw new Error("disk failure");
        }),
        getCampaignActions: vi.fn(),
      } as unknown as CampaignRepository;
    });

    await handleCampaignGet(1, {});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith("disk failure\n");
  });
});
