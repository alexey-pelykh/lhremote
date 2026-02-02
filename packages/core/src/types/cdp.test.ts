import { describe, expect, it } from "vitest";
import type { CdpTarget } from "./cdp.js";

describe("CDP types", () => {
  it("should allow constructing a CdpTarget with webSocketDebuggerUrl", () => {
    const target: CdpTarget = {
      description: "",
      devtoolsFrontendUrl: "/devtools/inspector.html?ws=localhost:9222/devtools/page/ABC123",
      id: "ABC123",
      type: "page",
      title: "LinkedHelper",
      url: "chrome-extension://abc/index.html",
      webSocketDebuggerUrl: "ws://localhost:9222/devtools/page/ABC123",
    };

    expect(target.type).toBe("page");
    expect(target.webSocketDebuggerUrl).toContain("ws://");
  });

  it("should allow CdpTarget without webSocketDebuggerUrl (another client attached)", () => {
    const target: CdpTarget = {
      description: "",
      devtoolsFrontendUrl: "/devtools/inspector.html?ws=localhost:9222/devtools/page/DEF456",
      id: "DEF456",
      type: "page",
      title: "LinkedHelper",
      url: "chrome-extension://abc/index.html",
    };

    expect(target.webSocketDebuggerUrl).toBeUndefined();
  });
});
