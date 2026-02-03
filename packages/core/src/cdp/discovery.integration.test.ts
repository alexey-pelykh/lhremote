import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discoverTargets } from "./discovery.js";
import {
  launchChromium,
  type ChromiumInstance,
} from "./testing/launch-chromium.js";

describe("discoverTargets (integration)", () => {
  let chromium: ChromiumInstance;

  beforeAll(async () => {
    chromium = await launchChromium();
  }, 30_000);

  afterAll(async () => {
    await chromium.close();
  });

  it("should return targets from a real Chromium instance", async () => {
    const targets = await discoverTargets(chromium.port);

    expect(targets.length).toBeGreaterThan(0);
  });

  it("should return targets with expected shape", async () => {
    const targets = await discoverTargets(chromium.port);
    const page = targets.find((t) => t.type === "page");

    expect(page).toBeDefined();
    expect(page?.id).toEqual(expect.any(String));
    expect(page?.webSocketDebuggerUrl).toEqual(expect.any(String));
    expect(page?.webSocketDebuggerUrl).toMatch(/^ws:\/\//);
  });
});
