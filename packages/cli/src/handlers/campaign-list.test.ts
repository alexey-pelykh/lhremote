import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    DatabaseClient: vi.fn(),
    CampaignRepository: vi.fn(),
    discoverAllDatabases: vi.fn(),
  };
});

import { type CampaignSummary, CampaignRepository } from "@lhremote/core";

import { handleCampaignList } from "./campaign-list.js";
import { mockDb, mockDiscovery } from "./testing/mock-helpers.js";

const MOCK_CAMPAIGNS: CampaignSummary[] = [
  {
    id: 1,
    name: "Outreach Q1",
    state: "active",
    liAccountId: 42,
    actionCount: 3,
    createdAt: "2025-01-01T00:00:00Z",
    description: "Q1 outreach campaign",
  },
  {
    id: 2,
    name: "Follow-Up",
    state: "paused",
    liAccountId: 42,
    actionCount: 1,
    createdAt: "2025-01-02T00:00:00Z",
    description: null,
  },
];

function mockRepo(campaigns: CampaignSummary[] = MOCK_CAMPAIGNS) {
  vi.mocked(CampaignRepository).mockImplementation(function () {
    return {
      listCampaigns: vi.fn().mockReturnValue(campaigns),
    } as unknown as CampaignRepository;
  });
}

function setupSuccessPath() {
  mockDiscovery();
  mockDb();
  mockRepo();
}

describe("handleCampaignList", () => {
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

    await handleCampaignList({ json: true });

    expect(process.exitCode).toBeUndefined();
    const parsed = JSON.parse(getStdout());
    expect(parsed.campaigns).toHaveLength(2);
    expect(parsed.total).toBe(2);
  });

  it("prints human-readable output", async () => {
    setupSuccessPath();

    await handleCampaignList({});

    expect(process.exitCode).toBeUndefined();
    const output = getStdout();
    expect(output).toContain("Campaigns (2 total):");
    expect(output).toContain("#1  Outreach Q1");
    expect(output).toContain("[active]");
    expect(output).toContain("3 actions");
    expect(output).toContain("Q1 outreach campaign");
    expect(output).toContain("#2  Follow-Up");
    expect(output).toContain("[paused]");
  });

  it("prints 'No campaigns found' when empty", async () => {
    mockDiscovery();
    mockDb();
    mockRepo([]);

    await handleCampaignList({});

    expect(process.exitCode).toBeUndefined();
    expect(getStdout()).toContain("No campaigns found.");
  });

  it("sets exitCode 1 when no databases found", async () => {
    mockDiscovery(new Map());

    await handleCampaignList({});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "No LinkedHelper databases found.\n",
    );
  });

  it("passes includeArchived option to repository", async () => {
    mockDiscovery();
    mockDb();
    const listCampaigns = vi.fn().mockReturnValue([]);
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return { listCampaigns } as unknown as CampaignRepository;
    });

    await handleCampaignList({ includeArchived: true });

    expect(listCampaigns).toHaveBeenCalledWith({ includeArchived: true });
  });

  it("closes database after listing", async () => {
    mockDiscovery();
    const { close } = mockDb();
    mockRepo();

    await handleCampaignList({});

    expect(close).toHaveBeenCalledOnce();
  });

  it("sets exitCode 1 on database error", async () => {
    mockDiscovery();
    mockDb();
    vi.mocked(CampaignRepository).mockImplementation(function () {
      return {
        listCampaigns: vi.fn().mockImplementation(() => {
          throw new Error("database locked");
        }),
      } as unknown as CampaignRepository;
    });

    await handleCampaignList({});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("database locked"),
    );
  });
});
