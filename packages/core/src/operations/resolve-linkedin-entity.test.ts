// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../cdp/index.js", () => ({
  resolveInstancePort: vi.fn(),
}));

vi.mock("../cdp/client.js", () => ({
  CDPClient: vi.fn(),
}));

vi.mock("../cdp/discovery.js", () => ({
  discoverTargets: vi.fn(),
}));

import { resolveInstancePort } from "../cdp/index.js";
import { CDPClient } from "../cdp/client.js";
import { discoverTargets } from "../cdp/discovery.js";
import { resolveLinkedInEntity } from "./resolve-linkedin-entity.js";

const LINKEDIN_TARGET = {
  id: "target-1",
  type: "page" as const,
  title: "LinkedIn",
  url: "https://www.linkedin.com/feed/",
  description: "",
  devtoolsFrontendUrl: "",
};

const mockClient = {
  connect: vi.fn().mockResolvedValue(undefined),
  evaluate: vi.fn(),
  disconnect: vi.fn(),
};

function setupVoyagerMocks() {
  vi.mocked(resolveInstancePort).mockResolvedValue(9222);
  vi.mocked(CDPClient).mockImplementation(function () {
    return mockClient as unknown as CDPClient;
  });
  vi.mocked(discoverTargets).mockResolvedValue([LINKEDIN_TARGET]);
}

describe("resolveLinkedInEntity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("public typeahead (COMPANY/GEO)", () => {
    it("uses public strategy when public endpoint succeeds", async () => {
      vi.mocked(resolveInstancePort).mockResolvedValue(9222);

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          elements: [
            {
              hitInfo: {
                id: "1234",
                displayName: "Acme Corp",
              },
            },
          ],
        }),
      };
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockResponse as unknown as Response,
      );

      const result = await resolveLinkedInEntity({
        query: "Acme",
        entityType: "COMPANY",
        cdpPort: 9222,
      });

      expect(result.strategy).toBe("public");
      expect(result.matches).toEqual([
        { id: "1234", name: "Acme Corp", type: "COMPANY" },
      ]);
    });

    it("returns empty matches when public endpoint returns no elements", async () => {
      vi.mocked(resolveInstancePort).mockResolvedValue(9222);

      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ elements: [] }),
      } as unknown as Response);

      const result = await resolveLinkedInEntity({
        query: "NonexistentCorp",
        entityType: "COMPANY",
        cdpPort: 9222,
      });

      expect(result.strategy).toBe("public");
      expect(result.matches).toEqual([]);
    });

    it("falls back to Voyager when public endpoint fails", async () => {
      setupVoyagerMocks();

      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: false,
        status: 500,
      } as unknown as Response);

      mockClient.evaluate.mockResolvedValue({
        data: {
          elements: [
            {
              targetUrn: "urn:li:organization:5678",
              title: { text: "Fallback Corp" },
            },
          ],
        },
      });

      const result = await resolveLinkedInEntity({
        query: "Fallback",
        entityType: "COMPANY",
        cdpPort: 9222,
      });

      expect(result.strategy).toBe("voyager");
      expect(result.matches).toEqual([
        { id: "5678", name: "Fallback Corp", type: "COMPANY" },
      ]);
    });

    it("falls back to Voyager when public fetch throws", async () => {
      setupVoyagerMocks();

      vi.spyOn(globalThis, "fetch").mockRejectedValue(
        new Error("network error"),
      );

      mockClient.evaluate.mockResolvedValue({
        data: { elements: [] },
      });

      const result = await resolveLinkedInEntity({
        query: "test",
        entityType: "GEO",
        cdpPort: 9222,
      });

      expect(result.strategy).toBe("voyager");
    });

    it("uses GEO typeahead type for public endpoint", async () => {
      vi.mocked(resolveInstancePort).mockResolvedValue(9222);

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          elements: [
            { hitInfo: { id: "101", locationName: "San Francisco" } },
          ],
        }),
      } as unknown as Response);

      await resolveLinkedInEntity({
        query: "San Francisco",
        entityType: "GEO",
        cdpPort: 9222,
      });

      const url = fetchSpy.mock.calls[0]?.[0] as string;
      expect(url).toContain("typeaheadType=GEO");
      expect(url).toContain("query=San+Francisco");
    });

    it("limits public results to 10", async () => {
      vi.mocked(resolveInstancePort).mockResolvedValue(9222);

      const elements = Array.from({ length: 15 }, (_, i) => ({
        hitInfo: { id: String(i), displayName: `Company ${String(i)}` },
      }));

      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ elements }),
      } as unknown as Response);

      const result = await resolveLinkedInEntity({
        query: "test",
        entityType: "COMPANY",
        cdpPort: 9222,
      });

      expect(result.matches).toHaveLength(10);
    });

    it("filters out elements without hitInfo.id", async () => {
      vi.mocked(resolveInstancePort).mockResolvedValue(9222);

      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          elements: [
            { hitInfo: { id: "1", displayName: "Valid" } },
            { hitInfo: { displayName: "No ID" } },
            { hitInfo: { id: "3", companyName: "Also Valid" } },
          ],
        }),
      } as unknown as Response);

      const result = await resolveLinkedInEntity({
        query: "test",
        entityType: "COMPANY",
        cdpPort: 9222,
      });

      expect(result.matches).toHaveLength(2);
      expect(result.matches[0]?.id).toBe("1");
      expect(result.matches[1]?.id).toBe("3");
    });
  });

  describe("Voyager typeahead (SCHOOL)", () => {
    it("goes directly to Voyager for SCHOOL entity type", async () => {
      setupVoyagerMocks();

      const fetchSpy = vi.spyOn(globalThis, "fetch");

      mockClient.evaluate.mockResolvedValue({
        data: {
          elements: [
            {
              targetUrn: "urn:li:school:12345",
              title: { text: "MIT" },
            },
          ],
        },
      });

      const result = await resolveLinkedInEntity({
        query: "MIT",
        entityType: "SCHOOL",
        cdpPort: 9222,
      });

      // Public endpoint should NOT be called for SCHOOL
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.strategy).toBe("voyager");
      expect(result.matches).toEqual([
        { id: "12345", name: "MIT", type: "SCHOOL" },
      ]);
    });

    it("extracts ID from tracking URN when targetUrn is missing", async () => {
      setupVoyagerMocks();

      mockClient.evaluate.mockResolvedValue({
        data: {
          elements: [
            {
              trackingUrn: "urn:li:school:99999",
              title: { text: "Stanford" },
            },
          ],
        },
      });

      const result = await resolveLinkedInEntity({
        query: "Stanford",
        entityType: "SCHOOL",
        cdpPort: 9222,
      });

      expect(result.matches[0]?.id).toBe("99999");
    });

    it("disconnects client after Voyager request", async () => {
      setupVoyagerMocks();

      mockClient.evaluate.mockResolvedValue({
        data: { elements: [] },
      });

      await resolveLinkedInEntity({
        query: "test",
        entityType: "SCHOOL",
        cdpPort: 9222,
      });

      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it("disconnects client even when Voyager request fails", async () => {
      setupVoyagerMocks();

      mockClient.evaluate.mockResolvedValue({
        error: "HTTP 403: Forbidden",
      });

      await expect(
        resolveLinkedInEntity({
          query: "test",
          entityType: "SCHOOL",
          cdpPort: 9222,
        }),
      ).rejects.toThrow("Voyager typeahead request failed");

      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it("throws when no LinkedIn page is found", async () => {
      vi.mocked(resolveInstancePort).mockResolvedValue(9222);
      vi.mocked(CDPClient).mockImplementation(function () {
        return mockClient as unknown as CDPClient;
      });
      vi.mocked(discoverTargets).mockResolvedValue([
        {
          id: "target-1",
          type: "page",
          title: "Example",
          url: "https://example.com",
          description: "",
          devtoolsFrontendUrl: "",
        },
      ]);

      await expect(
        resolveLinkedInEntity({
          query: "test",
          entityType: "SCHOOL",
          cdpPort: 9222,
        }),
      ).rejects.toThrow("No LinkedIn page found");
    });
  });

  describe("security", () => {
    it("rejects non-loopback host without allowRemote", async () => {
      vi.mocked(resolveInstancePort).mockResolvedValue(9222);
      vi.mocked(discoverTargets).mockResolvedValue([LINKEDIN_TARGET]);

      await expect(
        resolveLinkedInEntity({
          query: "test",
          entityType: "SCHOOL",
          cdpPort: 9222,
          cdpHost: "192.168.1.100",
        }),
      ).rejects.toThrow("requires --allow-remote");
    });

    it("allows non-loopback host with allowRemote", async () => {
      setupVoyagerMocks();

      mockClient.evaluate.mockResolvedValue({
        data: { elements: [] },
      });

      const result = await resolveLinkedInEntity({
        query: "test",
        entityType: "SCHOOL",
        cdpPort: 9222,
        cdpHost: "192.168.1.100",
        allowRemote: true,
      });

      expect(result.strategy).toBe("voyager");
    });

    it("allows localhost without allowRemote", async () => {
      setupVoyagerMocks();

      mockClient.evaluate.mockResolvedValue({
        data: { elements: [] },
      });

      const result = await resolveLinkedInEntity({
        query: "test",
        entityType: "SCHOOL",
        cdpPort: 9222,
        cdpHost: "localhost",
      });

      expect(result.strategy).toBe("voyager");
    });
  });

  describe("connection options", () => {
    it("defaults cdpHost to 127.0.0.1", async () => {
      setupVoyagerMocks();

      mockClient.evaluate.mockResolvedValue({
        data: { elements: [] },
      });

      await resolveLinkedInEntity({
        query: "test",
        entityType: "SCHOOL",
        cdpPort: 9222,
      });

      expect(discoverTargets).toHaveBeenCalledWith(9222, "127.0.0.1");
    });

    it("uses resolveInstancePort to determine actual port", async () => {
      vi.mocked(resolveInstancePort).mockResolvedValue(35000);
      vi.mocked(CDPClient).mockImplementation(function () {
        return mockClient as unknown as CDPClient;
      });
      vi.mocked(discoverTargets).mockResolvedValue([LINKEDIN_TARGET]);

      mockClient.evaluate.mockResolvedValue({
        data: { elements: [] },
      });

      await resolveLinkedInEntity({
        query: "test",
        entityType: "SCHOOL",
        cdpPort: 9222,
      });

      expect(resolveInstancePort).toHaveBeenCalledWith(9222, undefined);
      expect(discoverTargets).toHaveBeenCalledWith(35000, "127.0.0.1");
    });
  });
});
