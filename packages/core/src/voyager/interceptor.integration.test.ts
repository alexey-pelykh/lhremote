// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { CDPClient } from "../cdp/client.js";
import {
  launchChromium,
  type ChromiumInstance,
} from "../cdp/testing/launch-chromium.js";
import { VoyagerInterceptor } from "./interceptor.js";

describe("VoyagerInterceptor (integration)", () => {
  let chromium: ChromiumInstance;
  let client: CDPClient;
  let interceptor: VoyagerInterceptor;

  beforeAll(async () => {
    chromium = await launchChromium();
  }, 30_000);

  afterAll(async () => {
    await chromium.close();
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

      // Navigate to a page first so we have an origin for fetch
      await client.send("Page.enable");
      const loadPromise = client.waitForEvent("Page.loadEventFired");
      await client.navigate("http://example.com");
      await loadPromise;
      await client.send("Page.disable").catch(() => {});

      await interceptor.enable();

      // Use waitForResponse for deterministic waiting instead of setTimeout
      const responsePromise = interceptor.waitForResponse(undefined, 5000);

      // Trigger a fetch from within the page to a URL containing /voyager/api/
      // The request will likely 404, but the Network domain will still capture it
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

      // Navigate first
      await client.send("Page.enable");
      const loadPromise = client.waitForEvent("Page.loadEventFired");
      await client.navigate("http://example.com");
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
