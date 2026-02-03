import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pidToPorts, portToPid } from "pid-port";
import psList from "ps-list";
import {
  launchChromium,
  type ChromiumInstance,
} from "./testing/launch-chromium.js";

describe("instance-discovery packages (integration)", () => {
  let chromium: ChromiumInstance;

  beforeAll(async () => {
    chromium = await launchChromium();
  }, 30_000);

  afterAll(async () => {
    await chromium.close();
  });

  it("portToPid should find the Chromium process by port", async () => {
    const pid = await portToPid({ port: chromium.port, host: "*" });

    expect(pid).toEqual(expect.any(Number));
    expect(pid).toBeGreaterThan(0);
  });

  it("psList should include the Chromium process with correct ppid", async () => {
    const processes = await psList();
    const chromiumProc = processes.find(
      (p) => p.pid === chromium.process.pid,
    );

    expect(chromiumProc).toBeDefined();
    expect(chromiumProc?.ppid).toEqual(expect.any(Number));
  });

  it("pidToPorts should include the Chromium CDP port", async () => {
    const pid = await portToPid({ port: chromium.port, host: "*" });
    if (pid === undefined) {
      throw new Error("Expected portToPid to return a PID");
    }

    const ports = await pidToPorts(pid);

    expect(ports).toBeInstanceOf(Set);
    expect(ports.has(chromium.port)).toBe(true);
  });
});
