// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CDPClient } from "../cdp/client.js";
import { CDPEvaluationError, CDPTimeoutError } from "../cdp/errors.js";
import {
  VoyagerInterceptor,
  type VoyagerResponse,
  type VoyagerResponseHandler,
} from "./interceptor.js";

// ---------------------------------------------------------------------------
// Mock CDPClient
// ---------------------------------------------------------------------------

type EventListener = (params: unknown) => void;

interface MockCDPClient extends CDPClient {
  /** Emit a CDP event to registered listeners. */
  emit: (event: string, params: unknown) => void;
}

function createMockClient(): MockCDPClient {
  const listeners = new Map<string, Set<EventListener>>();

  return {
    send: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn(),
    on: vi.fn((event: string, listener: EventListener) => {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(listener);
    }),
    off: vi.fn((event: string, listener: EventListener) => {
      listeners.get(event)?.delete(listener);
    }),
    emit: (event: string, params: unknown) => {
      const set = listeners.get(event);
      if (set) {
        for (const listener of set) {
          listener(params);
        }
      }
    },
  } as unknown as MockCDPClient;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simulate a Voyager API response arriving via Network domain events. */
function simulateNetworkResponse(
  client: MockCDPClient,
  requestId: string,
  url: string,
  status: number,
  body: string,
  base64Encoded = false,
): void {
  // 1. responseReceived — headers arrive
  client.emit("Network.responseReceived", {
    requestId,
    response: { url, status },
  });

  // 2. Configure getResponseBody for this requestId
  vi.mocked(client.send).mockImplementation(async (method, params) => {
    if (
      method === "Network.getResponseBody" &&
      (params as { requestId: string })?.requestId === requestId
    ) {
      return { body, base64Encoded };
    }
    return undefined;
  });

  // 3. loadingFinished — body ready
  client.emit("Network.loadingFinished", { requestId });
}

/** Flush microtask queue so async handlers complete. */
async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((r) => {
    queueMicrotask(r);
  });
  // Extra tick to let nested microtasks settle
  await new Promise<void>((r) => {
    queueMicrotask(r);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("VoyagerInterceptor", () => {
  let client: MockCDPClient;
  let interceptor: VoyagerInterceptor;

  beforeEach(() => {
    client = createMockClient();
    interceptor = new VoyagerInterceptor(client);
  });

  afterEach(async () => {
    if (interceptor.isEnabled) {
      await interceptor.disable();
    }
  });

  // -------------------------------------------------------------------------
  // enable / disable lifecycle
  // -------------------------------------------------------------------------

  describe("enable / disable", () => {
    it("should enable the Network domain", async () => {
      await interceptor.enable();

      expect(client.send).toHaveBeenCalledWith("Network.enable");
      expect(interceptor.isEnabled).toBe(true);
    });

    it("should be idempotent when already enabled", async () => {
      await interceptor.enable();
      await interceptor.enable();

      expect(client.send).toHaveBeenCalledTimes(1);
    });

    it("should disable the Network domain", async () => {
      await interceptor.enable();
      await interceptor.disable();

      expect(client.send).toHaveBeenCalledWith("Network.disable");
      expect(interceptor.isEnabled).toBe(false);
    });

    it("should be idempotent when already disabled", async () => {
      await interceptor.disable();

      expect(client.send).not.toHaveBeenCalledWith("Network.disable");
    });

    it("should subscribe to Network events on enable", async () => {
      await interceptor.enable();

      expect(client.on).toHaveBeenCalledWith(
        "Network.responseReceived",
        expect.any(Function),
      );
      expect(client.on).toHaveBeenCalledWith(
        "Network.loadingFinished",
        expect.any(Function),
      );
      expect(client.on).toHaveBeenCalledWith(
        "Network.loadingFailed",
        expect.any(Function),
      );
    });

    it("should unsubscribe from Network events on disable", async () => {
      await interceptor.enable();
      await interceptor.disable();

      expect(client.off).toHaveBeenCalledWith(
        "Network.responseReceived",
        expect.any(Function),
      );
      expect(client.off).toHaveBeenCalledWith(
        "Network.loadingFinished",
        expect.any(Function),
      );
      expect(client.off).toHaveBeenCalledWith(
        "Network.loadingFailed",
        expect.any(Function),
      );
    });

    it("should clear pending requests on disable", async () => {
      await interceptor.enable();

      // Emit responseReceived without loadingFinished — leaves pending state
      client.emit("Network.responseReceived", {
        requestId: "R1",
        response: {
          url: "https://www.linkedin.com/voyager/api/feed",
          status: 200,
        },
      });

      await interceptor.disable();

      // After disable, a stale loadingFinished should not trigger body fetch
      vi.mocked(client.send).mockClear();
      client.emit("Network.loadingFinished", { requestId: "R1" });
      await flushMicrotasks();

      expect(client.send).not.toHaveBeenCalledWith(
        "Network.getResponseBody",
        expect.anything(),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Passive interception
  // -------------------------------------------------------------------------

  describe("passive interception", () => {
    it("should capture Voyager API responses", async () => {
      await interceptor.enable();

      const captured: VoyagerResponse[] = [];
      interceptor.onResponse((r) => captured.push(r));

      simulateNetworkResponse(
        client,
        "R1",
        "https://www.linkedin.com/voyager/api/feed/dash/feedUpdates",
        200,
        JSON.stringify({ elements: [{ urn: "urn:li:activity:123" }] }),
      );
      await flushMicrotasks();

      expect(captured).toHaveLength(1);
      expect(captured[0]).toEqual({
        url: "https://www.linkedin.com/voyager/api/feed/dash/feedUpdates",
        status: 200,
        body: { elements: [{ urn: "urn:li:activity:123" }] },
      });
    });

    it("should ignore non-Voyager URLs", async () => {
      await interceptor.enable();

      const captured: VoyagerResponse[] = [];
      interceptor.onResponse((r) => captured.push(r));

      // Regular LinkedIn page request — not a Voyager API call
      client.emit("Network.responseReceived", {
        requestId: "R1",
        response: { url: "https://www.linkedin.com/feed/", status: 200 },
      });
      client.emit("Network.loadingFinished", { requestId: "R1" });
      await flushMicrotasks();

      expect(captured).toHaveLength(0);
    });

    it("should parse JSON response bodies", async () => {
      await interceptor.enable();

      const captured: VoyagerResponse[] = [];
      interceptor.onResponse((r) => captured.push(r));

      simulateNetworkResponse(
        client,
        "R1",
        "https://www.linkedin.com/voyager/api/search",
        200,
        JSON.stringify({ data: { results: [] } }),
      );
      await flushMicrotasks();

      expect(captured[0]?.body).toEqual({ data: { results: [] } });
    });

    it("should return raw string for non-JSON responses", async () => {
      await interceptor.enable();

      const captured: VoyagerResponse[] = [];
      interceptor.onResponse((r) => captured.push(r));

      simulateNetworkResponse(
        client,
        "R1",
        "https://www.linkedin.com/voyager/api/something",
        200,
        "not valid json",
      );
      await flushMicrotasks();

      expect(captured[0]?.body).toBe("not valid json");
    });

    it("should decode base64-encoded response bodies", async () => {
      await interceptor.enable();

      const captured: VoyagerResponse[] = [];
      interceptor.onResponse((r) => captured.push(r));

      const jsonBody = JSON.stringify({ ok: true });
      simulateNetworkResponse(
        client,
        "R1",
        "https://www.linkedin.com/voyager/api/test",
        200,
        btoa(jsonBody),
        true, // base64Encoded
      );
      await flushMicrotasks();

      expect(captured[0]?.body).toEqual({ ok: true });
    });

    it("should call multiple handlers", async () => {
      await interceptor.enable();

      const captured1: VoyagerResponse[] = [];
      const captured2: VoyagerResponse[] = [];
      interceptor.onResponse((r) => captured1.push(r));
      interceptor.onResponse((r) => captured2.push(r));

      simulateNetworkResponse(
        client,
        "R1",
        "https://www.linkedin.com/voyager/api/feed",
        200,
        "{}",
      );
      await flushMicrotasks();

      expect(captured1).toHaveLength(1);
      expect(captured2).toHaveLength(1);
    });

    it("should stop calling handler after offResponse", async () => {
      await interceptor.enable();

      const captured: VoyagerResponse[] = [];
      const handler: VoyagerResponseHandler = (r) => captured.push(r);
      interceptor.onResponse(handler);

      simulateNetworkResponse(
        client,
        "R1",
        "https://www.linkedin.com/voyager/api/feed",
        200,
        "{}",
      );
      await flushMicrotasks();
      expect(captured).toHaveLength(1);

      interceptor.offResponse(handler);

      simulateNetworkResponse(
        client,
        "R2",
        "https://www.linkedin.com/voyager/api/feed",
        200,
        "{}",
      );
      await flushMicrotasks();
      expect(captured).toHaveLength(1); // Still 1 — handler was removed
    });

    it("should clean up pending request on loading failure", async () => {
      await interceptor.enable();

      const captured: VoyagerResponse[] = [];
      interceptor.onResponse((r) => captured.push(r));

      // responseReceived creates pending entry
      client.emit("Network.responseReceived", {
        requestId: "R1",
        response: {
          url: "https://www.linkedin.com/voyager/api/feed",
          status: 200,
        },
      });

      // loadingFailed removes it
      client.emit("Network.loadingFailed", { requestId: "R1" });

      // Subsequent loadingFinished for same ID should not trigger body fetch
      client.emit("Network.loadingFinished", { requestId: "R1" });
      await flushMicrotasks();

      expect(captured).toHaveLength(0);
    });

    it("should silently skip when getResponseBody fails", async () => {
      await interceptor.enable();

      const captured: VoyagerResponse[] = [];
      interceptor.onResponse((r) => captured.push(r));

      client.emit("Network.responseReceived", {
        requestId: "R1",
        response: {
          url: "https://www.linkedin.com/voyager/api/feed",
          status: 200,
        },
      });

      vi.mocked(client.send).mockRejectedValueOnce(
        new Error("No data found for resource with given identifier"),
      );

      client.emit("Network.loadingFinished", { requestId: "R1" });
      await flushMicrotasks();

      expect(captured).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // waitForResponse
  // -------------------------------------------------------------------------

  describe("waitForResponse", () => {
    it("should resolve on matching response", async () => {
      await interceptor.enable();

      const waitPromise = interceptor.waitForResponse(undefined, 1000);

      simulateNetworkResponse(
        client,
        "R1",
        "https://www.linkedin.com/voyager/api/feed",
        200,
        JSON.stringify({ elements: [] }),
      );

      const result = await waitPromise;
      expect(result.url).toBe(
        "https://www.linkedin.com/voyager/api/feed",
      );
      expect(result.body).toEqual({ elements: [] });
    });

    it("should filter by URL predicate", async () => {
      await interceptor.enable();

      const waitPromise = interceptor.waitForResponse(
        (url) => url.includes("search"),
        1000,
      );

      // First: non-matching response
      simulateNetworkResponse(
        client,
        "R1",
        "https://www.linkedin.com/voyager/api/feed",
        200,
        "{}",
      );
      await flushMicrotasks();

      // Second: matching response
      simulateNetworkResponse(
        client,
        "R2",
        "https://www.linkedin.com/voyager/api/search/results",
        200,
        JSON.stringify({ hits: [] }),
      );

      const result = await waitPromise;
      expect(result.url).toContain("search");
    });

    it("should reject on timeout", async () => {
      await interceptor.enable();

      await expect(
        interceptor.waitForResponse(undefined, 50),
      ).rejects.toThrow(CDPTimeoutError);
    });
  });

  // -------------------------------------------------------------------------
  // Active fetch
  // -------------------------------------------------------------------------

  describe("fetch", () => {
    it("should evaluate fetch in page context and return response", async () => {
      vi.mocked(client.evaluate).mockResolvedValueOnce({
        url: "https://www.linkedin.com/voyager/api/feed",
        status: 200,
        body: { elements: [] },
      });

      const result = await interceptor.fetch("/voyager/api/feed");

      expect(client.evaluate).toHaveBeenCalledWith(
        expect.stringContaining("fetch("),
        true,
      );
      expect(result).toEqual({
        url: "https://www.linkedin.com/voyager/api/feed",
        status: 200,
        body: { elements: [] },
      });
    });

    it("should accept full URLs", async () => {
      vi.mocked(client.evaluate).mockResolvedValueOnce({
        url: "https://www.linkedin.com/voyager/api/search",
        status: 200,
        body: {},
      });

      await interceptor.fetch(
        "https://www.linkedin.com/voyager/api/search",
      );

      expect(client.evaluate).toHaveBeenCalledWith(
        expect.stringContaining("https://www.linkedin.com/voyager/api/search"),
        true,
      );
    });

    it("should include CSRF token extraction in evaluated expression", async () => {
      vi.mocked(client.evaluate).mockResolvedValueOnce({
        url: "https://www.linkedin.com/voyager/api/test",
        status: 200,
        body: {},
      });

      await interceptor.fetch("/voyager/api/test");

      expect(client.evaluate).toHaveBeenCalledWith(
        expect.stringContaining("JSESSIONID"),
        true,
      );
      expect(client.evaluate).toHaveBeenCalledWith(
        expect.stringContaining("Csrf-Token"),
        true,
      );
    });

    it("should include RestLi protocol version header", async () => {
      vi.mocked(client.evaluate).mockResolvedValueOnce({
        url: "https://www.linkedin.com/voyager/api/test",
        status: 200,
        body: {},
      });

      await interceptor.fetch("/voyager/api/test");

      expect(client.evaluate).toHaveBeenCalledWith(
        expect.stringContaining("X-RestLi-Protocol-Version"),
        true,
      );
    });

    it("should pass extra headers", async () => {
      vi.mocked(client.evaluate).mockResolvedValueOnce({
        url: "https://www.linkedin.com/voyager/api/test",
        status: 200,
        body: {},
      });

      await interceptor.fetch("/voyager/api/test", {
        headers: { "X-Custom": "value" },
      });

      expect(client.evaluate).toHaveBeenCalledWith(
        expect.stringContaining('"X-Custom":"value"'),
        true,
      );
    });

    it("should throw CDPEvaluationError on fetch failure", async () => {
      vi.mocked(client.evaluate).mockResolvedValue({
        url: "https://www.linkedin.com/voyager/api/test",
        status: 0,
        body: null,
        error: "TypeError: Failed to fetch",
      });

      await expect(
        interceptor.fetch("/voyager/api/test"),
      ).rejects.toThrow(CDPEvaluationError);
      await expect(
        interceptor.fetch("/voyager/api/test"),
      ).rejects.toThrow(/Voyager fetch failed/);
    });

    it("should work independently of enable/disable", async () => {
      // interceptor is not enabled — fetch should still work
      expect(interceptor.isEnabled).toBe(false);

      vi.mocked(client.evaluate).mockResolvedValueOnce({
        url: "https://www.linkedin.com/voyager/api/feed",
        status: 200,
        body: { elements: [] },
      });

      const result = await interceptor.fetch("/voyager/api/feed");
      expect(result.status).toBe(200);
    });

    it("should prepend slash when path does not start with one", async () => {
      vi.mocked(client.evaluate).mockResolvedValueOnce({
        url: "https://www.linkedin.com/voyager/api/test",
        status: 200,
        body: {},
      });

      await interceptor.fetch("voyager/api/test");

      expect(client.evaluate).toHaveBeenCalledWith(
        expect.stringContaining(
          "https://www.linkedin.com/voyager/api/test",
        ),
        true,
      );
    });
  });
});
