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

  private eventHandlers = new Map<string, Set<(ev: unknown) => void>>();

  readonly url: string;
  readyState = 0; // CONNECTING

  constructor(url: string | URL) {
    this.url = typeof url === "string" ? url : url.toString();
    MockWebSocket.instances.push(this);

    // Simulate async open
    queueMicrotask(() => {
      this.readyState = 1; // OPEN
      this.emit("open", {});
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
    vi.mocked(discoverTargets).mockResolvedValue(MOCK_TARGETS);
    client = new CDPClient(9222, { timeout: 500 });
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
});
