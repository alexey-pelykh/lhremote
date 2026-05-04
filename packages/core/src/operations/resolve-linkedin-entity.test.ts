// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveLinkedInEntity } from "./resolve-linkedin-entity.js";

describe("resolveLinkedInEntity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("public typeahead — happy path", () => {
    it("resolves COMPANY queries from the public endpoint array shape", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue([
          {
            id: "1234",
            type: "COMPANY",
            displayName: "Acme Corp",
            trackingId: "abc==",
          },
        ]),
      } as unknown as Response);

      const result = await resolveLinkedInEntity({
        query: "Acme",
        entityType: "COMPANY",
      });

      expect(result.matches).toEqual([
        { id: "1234", name: "Acme Corp", type: "COMPANY" },
      ]);

      const url = fetchSpy.mock.calls[0]?.[0] as string;
      expect(url).toContain("typeaheadType=COMPANY");
      expect(url).toContain("query=Acme");
    });

    it("resolves GEO queries with typeaheadType=GEO", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue([
          { id: "101", type: "GEO", displayName: "San Francisco" },
        ]),
      } as unknown as Response);

      await resolveLinkedInEntity({
        query: "San Francisco",
        entityType: "GEO",
      });

      const url = fetchSpy.mock.calls[0]?.[0] as string;
      expect(url).toContain("typeaheadType=GEO");
      expect(url).toContain("query=San+Francisco");
    });

    it("resolves SCHOOL queries through the COMPANY namespace, preserving SCHOOL in the result type", async () => {
      // LinkedIn stores schools as organizations; the public endpoint silently
      // ignores typeaheadType=SCHOOL. SCHOOL queries must use the COMPANY
      // typeahead but the returned EntityMatch carries the caller's intent
      // (entityType: SCHOOL) so downstream URL construction can choose the
      // urn:li:school: scheme if needed.
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue([
          {
            id: "1792",
            type: "COMPANY",
            displayName: "Stanford University",
          },
        ]),
      } as unknown as Response);

      const result = await resolveLinkedInEntity({
        query: "Stanford",
        entityType: "SCHOOL",
      });

      const url = fetchSpy.mock.calls[0]?.[0] as string;
      expect(url).toContain("typeaheadType=COMPANY");
      expect(url).toContain("query=Stanford");

      expect(result.matches).toEqual([
        { id: "1792", name: "Stanford University", type: "SCHOOL" },
      ]);
    });
  });

  describe("public typeahead — empty / drift", () => {
    it("returns empty matches when the endpoint returns an empty array", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue([]),
      } as unknown as Response);

      const result = await resolveLinkedInEntity({
        query: "ZeroResults Inc",
        entityType: "COMPANY",
      });

      expect(result.matches).toEqual([]);
    });

    it("returns empty matches (no throw) when the response shape is not an array — defensive against API drift", async () => {
      // Defends against the original bug pattern: when the parser previously
      // expected an object {elements: [...]}, an array response silently
      // produced []. The inverse — an object response when we expect array —
      // is the same risk after a hypothetical future drift. Parser fails
      // cleanly to [] so shape drift surfaces as "no matches" rather than
      // a hard error.
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ elements: [] }),
      } as unknown as Response);

      const result = await resolveLinkedInEntity({
        query: "test",
        entityType: "COMPANY",
      });

      expect(result.matches).toEqual([]);
    });

    it("filters out entries without an id", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue([
          { id: "1", type: "COMPANY", displayName: "Valid" },
          { type: "COMPANY", displayName: "No ID" },
          { id: "3", type: "COMPANY", displayName: "Also Valid" },
        ]),
      } as unknown as Response);

      const result = await resolveLinkedInEntity({
        query: "test",
        entityType: "COMPANY",
      });

      expect(result.matches).toHaveLength(2);
      expect(result.matches[0]?.id).toBe("1");
      expect(result.matches[1]?.id).toBe("3");
    });

    it("limits matches to 10", async () => {
      const entries = Array.from({ length: 15 }, (_, i) => ({
        id: String(i),
        type: "COMPANY",
        displayName: `Company ${String(i)}`,
      }));

      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(entries),
      } as unknown as Response);

      const result = await resolveLinkedInEntity({
        query: "test",
        entityType: "COMPANY",
      });

      expect(result.matches).toHaveLength(10);
    });
  });

  describe("public typeahead — error surfacing", () => {
    it("throws on HTTP non-2xx responses", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: false,
        status: 500,
      } as unknown as Response);

      await expect(
        resolveLinkedInEntity({
          query: "test",
          entityType: "COMPANY",
        }),
      ).rejects.toThrow("Public typeahead request failed: HTTP 500");
    });

    it("propagates network errors from fetch", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(
        new Error("network error"),
      );

      await expect(
        resolveLinkedInEntity({
          query: "test",
          entityType: "GEO",
        }),
      ).rejects.toThrow("network error");
    });
  });
});
