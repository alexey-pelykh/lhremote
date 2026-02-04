import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Profile } from "../types/index.js";
import { ExtractionTimeoutError } from "./errors.js";
import { extractSlug, ProfileService } from "./profile.js";

// Mock InstanceService
const mockNavigateToProfile = vi.fn();
const mockTriggerExtraction = vi.fn();

vi.mock("./instance.js", () => ({
  InstanceService: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.navigateToProfile = mockNavigateToProfile;
    this.triggerExtraction = mockTriggerExtraction;
  }),
}));

// Mock ProfileRepository (via db/index.js)
const mockFindByPublicId = vi.fn();

vi.mock("../db/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../db/index.js")>();
  return {
    ProfileRepository: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      this.findByPublicId = mockFindByPublicId;
    }),
    ProfileNotFoundError: original.ProfileNotFoundError,
  };
});

import { ProfileNotFoundError } from "../db/index.js";
import { InstanceService } from "./instance.js";

const MOCK_PROFILE: Profile = {
  id: 1,
  miniProfile: {
    firstName: "Test",
    lastName: "User",
    headline: "Engineer",
    avatar: null,
  },
  externalIds: [],
  currentPosition: null,
  positions: [],
  education: [],
  skills: [],
  emails: [],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("extractSlug", () => {
  it("extracts slug from standard URL", () => {
    expect(extractSlug("https://www.linkedin.com/in/john-doe")).toBe(
      "john-doe",
    );
  });

  it("extracts slug from URL with trailing slash", () => {
    expect(extractSlug("https://www.linkedin.com/in/john-doe/")).toBe(
      "john-doe",
    );
  });

  it("extracts slug from URL with query params", () => {
    expect(
      extractSlug("https://www.linkedin.com/in/john-doe?param=1"),
    ).toBe("john-doe");
  });

  it("extracts slug from URL without www", () => {
    expect(extractSlug("https://linkedin.com/in/john-doe")).toBe(
      "john-doe",
    );
  });

  it("decodes percent-encoded Unicode slug", () => {
    expect(
      extractSlug(
        "https://www.linkedin.com/in/caf%C3%A9-d%C3%A9veloppeur-123456",
      ),
    ).toBe("café-développeur-123456");
  });

  it("decodes percent-encoded slug with trailing slash", () => {
    expect(
      extractSlug(
        "https://www.linkedin.com/in/caf%C3%A9-d%C3%A9veloppeur-123456/",
      ),
    ).toBe("café-développeur-123456");
  });

  it("passes through already-decoded Unicode slug", () => {
    expect(
      extractSlug("https://www.linkedin.com/in/café-développeur-123456"),
    ).toBe("café-développeur-123456");
  });

  it("throws on URL without /in/ segment", () => {
    expect(() => extractSlug("https://www.linkedin.com/company/test")).toThrow(
      /Invalid LinkedIn profile URL/,
    );
  });

  it("throws on URL with /in/ but no slug", () => {
    expect(() => extractSlug("https://www.linkedin.com/in/")).toThrow(
      /Invalid LinkedIn profile URL/,
    );
  });
});

describe("ProfileService", () => {
  let service: ProfileService;

  beforeEach(() => {
    vi.useFakeTimers();
    mockNavigateToProfile.mockResolvedValue(undefined);
    mockTriggerExtraction.mockResolvedValue(undefined);

    const instance = new InstanceService(9223);
    service = new ProfileService(instance, {} as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns profile on first poll", async () => {
    mockFindByPublicId.mockReturnValue(MOCK_PROFILE);

    const promise = service.visitAndExtract(
      "https://www.linkedin.com/in/test-user",
      { pollInterval: 100, pollTimeout: 5000 },
    );

    // Advance past settle delay
    await vi.advanceTimersByTimeAsync(2000);
    // Advance past first poll interval
    await vi.advanceTimersByTimeAsync(100);

    const result = await promise;

    expect(mockNavigateToProfile).toHaveBeenCalledWith(
      "https://www.linkedin.com/in/test-user",
    );
    expect(mockTriggerExtraction).toHaveBeenCalled();
    expect(mockFindByPublicId).toHaveBeenCalledWith("test-user");
    expect(result).toEqual(MOCK_PROFILE);
  });

  it("polls until profile appears", async () => {
    let callCount = 0;
    mockFindByPublicId.mockImplementation(() => {
      callCount++;
      if (callCount < 3) {
        throw new ProfileNotFoundError("test-user");
      }
      return MOCK_PROFILE;
    });

    const promise = service.visitAndExtract(
      "https://www.linkedin.com/in/test-user",
      { pollInterval: 100, pollTimeout: 5000 },
    );

    // Advance timers enough for settle delay + a few poll cycles
    await vi.advanceTimersByTimeAsync(2500);

    const result = await promise;
    expect(result).toEqual(MOCK_PROFILE);
    expect(callCount).toBeGreaterThanOrEqual(3);
  });

  it("throws ExtractionTimeoutError when poll times out", async () => {
    mockFindByPublicId.mockImplementation(() => {
      throw new ProfileNotFoundError("test-user");
    });

    const promise = service.visitAndExtract(
      "https://www.linkedin.com/in/test-user",
      { pollInterval: 100, pollTimeout: 500 },
    );

    // Prevent unhandled rejection while advancing timers
    const caughtPromise = promise.catch((e: unknown) => e);

    // Advance past settle delay + poll timeout
    await vi.advanceTimersByTimeAsync(3000);

    const error = await caughtPromise;
    expect(error).toBeInstanceOf(ExtractionTimeoutError);
  });

  it("re-throws non-ProfileNotFoundError errors", async () => {
    mockFindByPublicId.mockImplementation(() => {
      throw new Error("database locked");
    });

    const promise = service.visitAndExtract(
      "https://www.linkedin.com/in/test-user",
      { pollInterval: 100, pollTimeout: 5000 },
    );

    // Prevent unhandled rejection while advancing timers
    const caughtPromise = promise.catch((e: unknown) => e);

    // Advance past settle delay so poll starts
    await vi.advanceTimersByTimeAsync(2100);

    const error = await caughtPromise;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("database locked");
  });

  it("calls navigate before triggerExtraction", async () => {
    const callOrder: string[] = [];
    mockNavigateToProfile.mockImplementation(async () => {
      callOrder.push("navigate");
    });
    mockTriggerExtraction.mockImplementation(async () => {
      callOrder.push("extract");
    });
    mockFindByPublicId.mockReturnValue(MOCK_PROFILE);

    const promise = service.visitAndExtract(
      "https://www.linkedin.com/in/test-user",
      { pollInterval: 100, pollTimeout: 5000 },
    );

    await vi.advanceTimersByTimeAsync(2100);

    await promise;

    expect(callOrder).toEqual(["navigate", "extract"]);
  });
});
