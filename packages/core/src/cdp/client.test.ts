// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CDPConnectionError,
  CDPEvaluationError,
  CDPTimeoutError,
} from "./errors.js";
import { CDPClient } from "./client.js";

// Mock discovery so CDPClient.connect() resolves a WebSocket URL
// without actually hitting a real HTTP endpoint.
vi.mock("./discovery.js", () => ({
  discoverTargets: vi.fn(),
}));

import { discoverTargets } from "./discovery.js";

/**
 * Minimal mock that simulates the browser-standard WebSocket API
 * used by Node 22's global WebSocket.
 */
class MockWebSocket {
  static instances: MockWebSocket[] = [];

  /**
   * Queue of behaviours for upcoming instances.  Each entry is applied to the
   * next constructed MockWebSocket.  When the queue is empty the default
   * behaviour (auto-open) is used.
   *
   * `"open"` – auto-open (default).
   * `"error"` – emit an error followed by close (simulates connection failure).
   */
  static nextBehaviors: Array<"open" | "error"> = [];

  private eventHandlers = new Map<string, Set<(ev: unknown) => void>>();

  readonly url: string;
  readyState = 0; // CONNECTING

  constructor(url: string | URL) {
    this.url = typeof url === "string" ? url : url.toString();
    MockWebSocket.instances.push(this);

    const behavior = MockWebSocket.nextBehaviors.shift() ?? "open";

    queueMicrotask(() => {
      if (behavior === "error") {
        this.readyState = 3; // CLOSED
        this.emit("error", {});
        this.emit("close", {});
      } else {
        this.readyState = 1; // OPEN
        this.emit("open", {});
      }
    });
  }

  addEventListener(event: string, handler: (ev: unknown) => void): void {
    let set = this.eventHandlers.get(event);
    if (!set) {
      set = new Set();
      this.eventHandlers.set(event, set);
    }
    set.add(handler);
  }

  send: (data: string) => void = () => {
    // default no-op, overridden by tests
  };

  close(): void {
    this.readyState = 3; // CLOSED
  }

  // Test helpers
  emit(event: string, data: unknown): void {
    const set = this.eventHandlers.get(event);
    if (set) {
      for (const handler of set) {
        handler(data);
      }
    }
  }

  /** Simulate receiving a CDP message from the server. */
  receiveMessage(obj: Record<string, unknown>): void {
    this.emit("message", { data: JSON.stringify(obj) });
  }
}

// Replace the global WebSocket with our mock
vi.stubGlobal("WebSocket", MockWebSocket);

const MOCK_TARGETS = [
  {
    description: "",
    devtoolsFrontendUrl: "",
    id: "PAGE1",
    type: "page",
    title: "Test Page",
    url: "about:blank",
    webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/PAGE1",
  },
];

function lastMockWs(): MockWebSocket {
  const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
  if (!ws) {
    throw new Error("No MockWebSocket instance created");
  }
  return ws;
}

describe("CDPClient", () => {
  let client: CDPClient;

  beforeEach(() => {
    MockWebSocket.instances = [];
    MockWebSocket.nextBehaviors = [];
    vi.mocked(discoverTargets).mockResolvedValue(MOCK_TARGETS);
    client = new CDPClient(9222, { timeout: 500 });
  });

  describe("loopback validation", () => {
    it("should allow default host (127.0.0.1)", () => {
      expect(() => new CDPClient(9222)).not.toThrow();
    });

    it("should allow explicit loopback host", () => {
      expect(() => new CDPClient(9222, { host: "localhost" })).not.toThrow();
      expect(() => new CDPClient(9222, { host: "::1" })).not.toThrow();
    });

    it("should reject non-loopback host without allowRemote", () => {
      expect(() => new CDPClient(9222, { host: "192.168.1.1" })).toThrow(
        CDPConnectionError,
      );
      expect(() => new CDPClient(9222, { host: "example.com" })).toThrow(
        /Remote CDP connections/,
      );
    });

    it("should allow non-loopback host with allowRemote", () => {
      expect(
        () => new CDPClient(9222, { host: "192.168.1.1", allowRemote: true }),
      ).not.toThrow();
      expect(
        () => new CDPClient(9222, { host: "example.com", allowRemote: true }),
      ).not.toThrow();
    });
  });

  afterEach(() => {
    client.disconnect();
    vi.restoreAllMocks();
  });

  describe("connect", () => {
    it("should connect to the first page target by default", async () => {
      await client.connect();

      expect(client.isConnected).toBe(true);
      expect(discoverTargets).toHaveBeenCalledWith(9222, "127.0.0.1");
      expect(MockWebSocket.instances).toHaveLength(1);
      expect(lastMockWs().url).toBe(
        "ws://127.0.0.1:9222/devtools/page/PAGE1",
      );
    });

    it("should connect to a specific target by ID", async () => {
      await client.connect("PAGE1");

      expect(client.isConnected).toBe(true);
    });

    it("should throw when target ID not found", async () => {
      await expect(client.connect("NONEXISTENT")).rejects.toThrow(
        CDPConnectionError,
      );
    });

    it("should throw when target has no webSocketDebuggerUrl", async () => {
      vi.mocked(discoverTargets).mockResolvedValue([
        {
          description: "",
          devtoolsFrontendUrl: "",
          id: "NOURL",
          type: "page",
          title: "No WS",
          url: "about:blank",
        },
      ]);

      await expect(client.connect()).rejects.toThrow(
        /webSocketDebuggerUrl/,
      );
    });
  });

  describe("send", () => {
    it("should throw when not connected", async () => {
      await expect(client.send("Runtime.evaluate")).rejects.toThrow(
        CDPConnectionError,
      );
    });

    it("should correlate request and response by message ID", async () => {
      await client.connect();
      const ws = lastMockWs();

      let sentMessage: string | undefined;
      ws.send = (data: string) => {
        sentMessage = data;
      };

      const resultPromise = client.send("Runtime.evaluate", {
        expression: "1+1",
      });

      // Wait for send to be called
      await vi.waitFor(() => expect(sentMessage).toBeDefined());

      const parsed = JSON.parse(sentMessage as string) as {
        id: number;
        method: string;
      };
      expect(parsed.method).toBe("Runtime.evaluate");

      // Simulate response
      ws.receiveMessage({
        id: parsed.id,
        result: { result: { type: "number", value: 2 } },
      });

      const result = await resultPromise;
      expect(result).toEqual({ result: { type: "number", value: 2 } });
    });

    it("should reject on CDP error response", async () => {
      await client.connect();
      const ws = lastMockWs();

      let sentId: number | undefined;
      ws.send = (data: string) => {
        sentId = (JSON.parse(data) as { id: number }).id;
      };

      const resultPromise = client.send("BadMethod");

      await vi.waitFor(() => expect(sentId).toBeDefined());

      ws.receiveMessage({
        id: sentId,
        error: { message: "Method not found" },
      });

      await expect(resultPromise).rejects.toThrow(CDPEvaluationError);
      await expect(resultPromise).rejects.toThrow(/Method not found/);
    });

    it("should reject on timeout", async () => {
      await client.connect();
      const ws = lastMockWs();
      ws.send = () => {
        /* swallow, never respond */
      };

      await expect(client.send("Slow.method")).rejects.toThrow(
        CDPTimeoutError,
      );
    });
  });

  describe("evaluate", () => {
    it("should return evaluated value", async () => {
      await client.connect();
      const ws = lastMockWs();

      ws.send = (data: string) => {
        const msg = JSON.parse(data) as { id: number };
        queueMicrotask(() => {
          ws.receiveMessage({
            id: msg.id,
            result: { result: { type: "number", value: 42 } },
          });
        });
      };

      const result = await client.evaluate<number>("21 * 2");
      expect(result).toBe(42);
    });

    it("should throw CDPEvaluationError on exception", async () => {
      await client.connect();
      const ws = lastMockWs();

      ws.send = (data: string) => {
        const msg = JSON.parse(data) as { id: number };
        queueMicrotask(() => {
          ws.receiveMessage({
            id: msg.id,
            result: {
              exceptionDetails: {
                exception: { description: "ReferenceError: x is not defined" },
              },
            },
          });
        });
      };

      await expect(client.evaluate("x")).rejects.toThrow(
        CDPEvaluationError,
      );
      await expect(client.evaluate("x")).rejects.toThrow(
        /ReferenceError/,
      );
    });
  });

  describe("navigate", () => {
    it("should accept https: URLs", async () => {
      await client.connect();
      const ws = lastMockWs();

      ws.send = (data: string) => {
        const msg = JSON.parse(data) as { id: number };
        queueMicrotask(() => {
          ws.receiveMessage({
            id: msg.id,
            result: { frameId: "F1" },
          });
        });
      };

      const result = await client.navigate("https://example.com");
      expect(result).toEqual({ frameId: "F1" });
    });

    it("should accept http: URLs", async () => {
      await client.connect();
      const ws = lastMockWs();

      ws.send = (data: string) => {
        const msg = JSON.parse(data) as { id: number };
        queueMicrotask(() => {
          ws.receiveMessage({
            id: msg.id,
            result: { frameId: "F1" },
          });
        });
      };

      const result = await client.navigate("http://example.com");
      expect(result).toEqual({ frameId: "F1" });
    });

    it("should reject file: URLs", async () => {
      await client.connect();

      await expect(client.navigate("file:///etc/passwd")).rejects.toThrow(
        TypeError,
      );
      await expect(client.navigate("file:///etc/passwd")).rejects.toThrow(
        /Unsafe URL scheme: file:/,
      );
    });

    it("should reject javascript: URLs", async () => {
      await client.connect();

      await expect(
        client.navigate("javascript:alert(1)"),
      ).rejects.toThrow(TypeError);
      await expect(
        client.navigate("javascript:alert(1)"),
      ).rejects.toThrow(/Unsafe URL scheme: javascript:/);
    });

    it("should reject data: URLs", async () => {
      await client.connect();

      await expect(
        client.navigate("data:text/html,<h1>Test</h1>"),
      ).rejects.toThrow(TypeError);
      await expect(
        client.navigate("data:text/html,<h1>Test</h1>"),
      ).rejects.toThrow(/Unsafe URL scheme: data:/);
    });

    it("should throw on invalid URL strings", async () => {
      await client.connect();

      await expect(client.navigate("not-a-url")).rejects.toThrow();
    });
  });

  describe("events", () => {
    it("should dispatch CDP events to listeners", async () => {
      await client.connect();
      const ws = lastMockWs();

      const received: unknown[] = [];
      client.on("Page.loadEventFired", (params) => {
        received.push(params);
      });

      ws.receiveMessage({
        method: "Page.loadEventFired",
        params: { timestamp: 12345 },
      });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ timestamp: 12345 });
    });

    it("should remove listeners with off()", async () => {
      await client.connect();
      const ws = lastMockWs();

      const received: unknown[] = [];
      const handler = (params: unknown) => {
        received.push(params);
      };

      client.on("Network.requestWillBeSent", handler);
      ws.receiveMessage({
        method: "Network.requestWillBeSent",
        params: { requestId: "1" },
      });

      client.off("Network.requestWillBeSent", handler);
      ws.receiveMessage({
        method: "Network.requestWillBeSent",
        params: { requestId: "2" },
      });

      expect(received).toHaveLength(1);
    });

    it("should resolve waitForEvent on event", async () => {
      await client.connect();
      const ws = lastMockWs();

      const eventPromise = client.waitForEvent("Page.loadEventFired", 1000);

      ws.receiveMessage({
        method: "Page.loadEventFired",
        params: { timestamp: 99 },
      });

      const result = await eventPromise;
      expect(result).toEqual({ timestamp: 99 });
    });

    it("should reject waitForEvent on timeout", async () => {
      await client.connect();

      await expect(
        client.waitForEvent("Never.happens", 50),
      ).rejects.toThrow(CDPTimeoutError);
    });
  });

  describe("disconnect", () => {
    it("should reject pending requests on disconnect", async () => {
      await client.connect();
      const ws = lastMockWs();
      ws.send = () => {
        /* swallow */
      };

      const pendingPromise = client.send("Runtime.evaluate", {
        expression: "1",
      });

      client.disconnect();

      await expect(pendingPromise).rejects.toThrow(CDPConnectionError);
      expect(client.isConnected).toBe(false);
    });
  });

  describe("reconnection", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should attempt reconnection after WebSocket close on a connected client", async () => {
      await client.connect();
      const ws = lastMockWs();
      expect(MockWebSocket.instances).toHaveLength(1);

      // Simulate unexpected close — reconnection auto-opens (default behaviour)
      ws.emit("close", {});

      // Advance past the first backoff delay (500ms)
      await vi.advanceTimersByTimeAsync(500);

      // A second MockWebSocket should have been created for the reconnection
      expect(MockWebSocket.instances).toHaveLength(2);
      expect(client.isConnected).toBe(true);
    });

    it("should use exponential backoff timing", async () => {
      await client.connect();
      const ws = lastMockWs();

      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

      // All reconnection attempts will fail, so we can observe all 5 delays
      MockWebSocket.nextBehaviors = ["error", "error", "error", "error", "error"];

      ws.emit("close", {});

      // Advance past all backoff delays to let all 5 attempts complete
      await vi.advanceTimersByTimeAsync(15_500);

      // Extract the backoff delay values passed to setTimeout by the
      // reconnection loop.  The loop calls: await new Promise(r => setTimeout(r, delay))
      // We look for calls with the expected exponential backoff values.
      const backoffDelays = setTimeoutSpy.mock.calls
        .map((call) => call[1])
        .filter((ms): ms is number => typeof ms === "number" && ms >= 500);

      expect(backoffDelays).toEqual([500, 1000, 2000, 4000, 8000]);

      setTimeoutSpy.mockRestore();
    });

    it("should restore functionality after successful reconnection", async () => {
      await client.connect();
      const ws = lastMockWs();

      // Close the connection — next WebSocket will auto-open (default)
      ws.emit("close", {});
      expect(client.isConnected).toBe(false);

      // Advance past the first backoff (500ms) to allow reconnection
      await vi.advanceTimersByTimeAsync(500);

      expect(client.isConnected).toBe(true);

      // Verify the client can send messages on the new connection
      const newWs = lastMockWs();
      let sentMessage: string | undefined;
      newWs.send = (data: string) => {
        sentMessage = data;
      };

      const resultPromise = client.send("Runtime.evaluate", {
        expression: "1+1",
      });

      await vi.waitFor(() => expect(sentMessage).toBeDefined());

      const parsed = JSON.parse(sentMessage as string) as { id: number };
      newWs.receiveMessage({
        id: parsed.id,
        result: { result: { value: 2 } },
      });

      const result = await resultPromise;
      expect(result).toEqual({ result: { value: 2 } });
    });

    it("should transition to disconnected after exhausting max attempts", async () => {
      await client.connect();
      const ws = lastMockWs();

      // All 5 reconnection attempts will fail
      MockWebSocket.nextBehaviors = ["error", "error", "error", "error", "error"];

      ws.emit("close", {});

      // Advance past all 5 backoff delays: 500 + 1000 + 2000 + 4000 + 8000 = 15500
      await vi.advanceTimersByTimeAsync(15_500);

      // All 5 attempts exhausted (+ 1 original = 6 total instances)
      expect(MockWebSocket.instances).toHaveLength(6);
      expect(client.isConnected).toBe(false);
    });

    it("should reject pending requests when reconnection fails", async () => {
      await client.connect();
      const ws = lastMockWs();
      ws.send = () => {
        /* swallow */
      };

      // Create a pending request before the close
      const pendingPromise = client.send("Runtime.evaluate", {
        expression: "1",
      });

      // Close fires rejectAllPending with "WebSocket closed"
      ws.emit("close", {});

      await expect(pendingPromise).rejects.toThrow(CDPConnectionError);
      await expect(pendingPromise).rejects.toThrow(/WebSocket closed/);
    });

    it("should guard against concurrent reconnection attempts", async () => {
      await client.connect();
      const ws = lastMockWs();

      // First close triggers reconnection — make the first attempt slow (will
      // still be in progress when we trigger the second close)
      // All attempts error out so we can count them
      MockWebSocket.nextBehaviors = ["error", "error", "error", "error", "error"];

      // Trigger two close events in quick succession
      ws.emit("close", {});
      ws.emit("close", {});

      // Advance past all possible backoff time
      await vi.advanceTimersByTimeAsync(15_500);

      // Should only have the original + 5 reconnection attempts, not 10
      expect(MockWebSocket.instances).toHaveLength(6);
    });

    it("should not attempt reconnection when targetId is null", async () => {
      // The targetId guard is defense-in-depth. We test it by connecting
      // (so wasConnected becomes true), then nullifying targetId before
      // triggering close.
      await client.connect();
      const ws = lastMockWs();

      // Null out targetId to test the guard
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessing private field for testing
      (client as any).targetId = null;

      ws.emit("close", {});

      // Advance past potential backoff time
      await vi.advanceTimersByTimeAsync(15_500);

      // No reconnection attempts should have been made
      expect(MockWebSocket.instances).toHaveLength(1);
    });

    it("should succeed on a later attempt after initial failures", async () => {
      await client.connect();
      const ws = lastMockWs();

      // First two reconnection attempts fail, third succeeds (auto-open)
      MockWebSocket.nextBehaviors = ["error", "error", "open"];

      ws.emit("close", {});

      // Advance past first two backoff delays: 500 + 1000 = 1500
      await vi.advanceTimersByTimeAsync(1500);
      expect(client.isConnected).toBe(false);

      // Advance past third backoff delay: 2000
      await vi.advanceTimersByTimeAsync(2000);
      expect(client.isConnected).toBe(true);

      // Only original + 3 attempts (2 failed + 1 succeeded)
      expect(MockWebSocket.instances).toHaveLength(4);
    });
  });
});
