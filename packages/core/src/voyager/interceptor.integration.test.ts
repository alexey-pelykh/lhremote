// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { createServer, type Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { CDPClient } from "../cdp/client.js";
import {
  launchChromium,
  type ChromiumInstance,
} from "../cdp/testing/launch-chromium.js";
import { VoyagerInterceptor } from "./interceptor.js";

describe("VoyagerInterceptor (integration)", () => {
  let chromium: ChromiumInstance;
  let server: Server;
  let serverPort: number;
  let client: CDPClient;
  let interceptor: VoyagerInterceptor;

  beforeAll(async () => {
    chromium = await launchChromium();

    // Start a minimal local HTTP server to avoid external network dependency
    // (http://example.com caused Windows CI timeouts)
    server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html></html>");
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    serverPort = (server.address() as { port: number }).port;
  }, 30_000);

  afterAll(async () => {
    await chromium.close();
    server.close();
  });

  afterEach(async () => {
    if (interceptor?.isEnabled) {
      await interceptor.disable();
    }
    client?.disconnect();
  });

  describe("enable / disable", () => {
    it("should enable and disable without error on a real browser", async () => {
      client = new CDPClient(chromium.port);
      await client.connect();
      interceptor = new VoyagerInterceptor(client);

      await interceptor.enable();
      expect(interceptor.isEnabled).toBe(true);

      await interceptor.disable();
      expect(interceptor.isEnabled).toBe(false);
    });
  });

  describe("passive interception", () => {
    it("should capture responses matching Voyager URL pattern", async () => {
      client = new CDPClient(chromium.port);
      await client.connect();
      interceptor = new VoyagerInterceptor(client);

      // Navigate to the local HTTP server so we have an origin for fetch
      await client.send("Page.enable");
      const loadPromise = client.waitForEvent("Page.loadEventFired");
      await client.navigate(`http://localhost:${serverPort.toString()}`);
      await loadPromise;
      await client.send("Page.disable").catch(() => {});

      await interceptor.enable();

      // Use waitForResponse for deterministic waiting instead of setTimeout
      const responsePromise = interceptor.waitForResponse(undefined, 5000);

      // Trigger a fetch from within the page to a URL containing /voyager/api/
      // The local server responds with 200 to any path
      await client.evaluate(
        `fetch("/voyager/api/test-endpoint").catch(() => {})`,
        true,
      );

      const captured = await responsePromise;
      expect(captured.url).toContain("/voyager/api/");
    });
  });

  describe("waitForResponse", () => {
    it("should resolve when a matching response arrives", async () => {
      client = new CDPClient(chromium.port);
      await client.connect();
      interceptor = new VoyagerInterceptor(client);

      // Navigate to the local HTTP server so we have an origin for fetch
      await client.send("Page.enable");
      const loadPromise = client.waitForEvent("Page.loadEventFired");
      await client.navigate(`http://localhost:${serverPort.toString()}`);
      await loadPromise;
      await client.send("Page.disable").catch(() => {});

      await interceptor.enable();

      // Start waiting before triggering the fetch
      const responsePromise = interceptor.waitForResponse(
        undefined,
        5000,
      );

      // Trigger a fetch matching the voyager pattern
      await client.evaluate(
        `fetch("/voyager/api/integration-test").catch(() => {})`,
        true,
      );

      const response = await responsePromise;
      expect(response.url).toContain("/voyager/api/");
      expect(response.status).toEqual(expect.any(Number));
    });
  });
});
