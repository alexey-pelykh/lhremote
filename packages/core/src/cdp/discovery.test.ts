import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CdpTarget } from "../types/cdp.js";
import { CDPConnectionError } from "./errors.js";
import { discoverTargets } from "./discovery.js";

const MOCK_TARGETS: CdpTarget[] = [
  {
    description: "",
    devtoolsFrontendUrl:
      "/devtools/inspector.html?ws=127.0.0.1:9222/devtools/page/ABC",
    id: "ABC",
    type: "page",
    title: "LinkedHelper",
    url: "chrome-extension://abc/index.html",
    webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/ABC",
  },
  {
    description: "",
    devtoolsFrontendUrl:
      "/devtools/inspector.html?ws=127.0.0.1:9222/devtools/worker/DEF",
    id: "DEF",
    type: "service_worker",
    title: "Service Worker",
    url: "chrome-extension://abc/sw.js",
  },
];

describe("discoverTargets", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn<(input: string | URL | Request) => Promise<Response>>(),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return targets from /json/list endpoint", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(MOCK_TARGETS), { status: 200 }),
    );

    const targets = await discoverTargets(9222);

    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:9222/json/list");
    expect(targets).toHaveLength(2);
    expect(targets[0]?.id).toBe("ABC");
    expect(targets[1]?.type).toBe("service_worker");
  });

  it("should use custom host when provided", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 }),
    );

    await discoverTargets(9222, "192.168.1.10");

    expect(fetch).toHaveBeenCalledWith(
      "http://192.168.1.10:9222/json/list",
    );
  });

  it("should throw CDPConnectionError when fetch fails", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(discoverTargets(9222)).rejects.toThrow(CDPConnectionError);
    await expect(discoverTargets(9222)).rejects.toThrow(
      /LinkedHelper not running/,
    );
  });

  it("should throw CDPConnectionError on non-OK HTTP status", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("Not Found", { status: 404 }),
    );

    await expect(discoverTargets(9222)).rejects.toThrow(CDPConnectionError);
    await expect(discoverTargets(9222)).rejects.toThrow(/HTTP 404/);
  });
});
