import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { CDPClient } from "./client.js";
import { CDPEvaluationError } from "./errors.js";
import {
  launchChromium,
  type ChromiumInstance,
} from "./testing/launch-chromium.js";

describe("CDPClient (integration)", () => {
  let chromium: ChromiumInstance;
  let client: CDPClient;

  beforeAll(async () => {
    chromium = await launchChromium();
  }, 30_000);

  afterAll(async () => {
    await chromium.close();
  });

  afterEach(() => {
    client.disconnect();
  });

  describe("connect", () => {
    it("should connect to a real Chromium page target", async () => {
      client = new CDPClient(chromium.port);
      await client.connect();

      expect(client.isConnected).toBe(true);
    });
  });

  describe("evaluate", () => {
    it("should evaluate a JavaScript expression", async () => {
      client = new CDPClient(chromium.port);
      await client.connect();

      const result = await client.evaluate<number>("2 + 2");

      expect(result).toBe(4);
    });

    it("should evaluate expressions returning objects", async () => {
      client = new CDPClient(chromium.port);
      await client.connect();

      const result = await client.evaluate<{ a: number; b: string }>(
        "({ a: 1, b: 'hello' })",
      );

      expect(result).toEqual({ a: 1, b: "hello" });
    });

    it("should throw CDPEvaluationError on runtime exception", async () => {
      client = new CDPClient(chromium.port);
      await client.connect();

      await expect(
        client.evaluate("throw new Error('test error')"),
      ).rejects.toThrow(CDPEvaluationError);
    });

    it("should await promise results when awaitPromise is true", async () => {
      client = new CDPClient(chromium.port);
      await client.connect();

      const result = await client.evaluate<number>(
        "Promise.resolve(42)",
        true,
      );

      expect(result).toBe(42);
    });
  });

  describe("navigate", () => {
    it("should navigate to a data URL", async () => {
      client = new CDPClient(chromium.port);
      await client.connect();

      const response = await client.navigate(
        "data:text/html,<h1>Integration Test</h1>",
      );

      expect(response.frameId).toEqual(expect.any(String));
    });
  });

  describe("events", () => {
    it("should receive CDP events from the browser", async () => {
      client = new CDPClient(chromium.port);
      await client.connect();

      // Enable Page domain to receive events
      await client.send("Page.enable");

      const eventPromise = client.waitForEvent(
        "Page.loadEventFired",
        10_000,
      );

      await client.navigate("data:text/html,<h1>Event Test</h1>");

      const params = (await eventPromise) as { timestamp: number };
      expect(params.timestamp).toEqual(expect.any(Number));
    });
  });
});
