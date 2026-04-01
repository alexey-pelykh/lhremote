// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CdpTarget } from "../types/cdp.js";
import { ActionExecutionError, ServiceError } from "./errors.js";
import { InstanceService } from "./instance.js";

/** Per-instance mock method sets, keyed by the target ID passed to connect(). */
interface ClientMocks {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  navigate: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
  waitForEvent: ReturnType<typeof vi.fn>;
  isConnected: ReturnType<typeof vi.fn<() => boolean>>;
}

/** All created client mocks, in creation order. */
let clientInstances: ClientMocks[] = [];

/** Lookup by target ID after connect() is called. */
let clientsByTargetId: Map<string, ClientMocks> = new Map();

vi.mock("../cdp/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../cdp/index.js")>();
  return {
    ...actual,
    CDPClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      const mocks: ClientMocks = {
        connect: vi.fn().mockImplementation(async (targetId?: string) => {
          if (targetId) {
            clientsByTargetId.set(targetId, mocks);
          }
        }),
        disconnect: vi.fn(),
        send: vi.fn().mockResolvedValue(undefined),
        navigate: vi.fn().mockResolvedValue({ frameId: "F1" }),
        evaluate: vi.fn().mockResolvedValue(undefined),
        waitForEvent: vi.fn().mockResolvedValue(undefined),
        isConnected: vi.fn<() => boolean>().mockReturnValue(true),
      };
      clientInstances.push(mocks);

      this.connect = mocks.connect;
      this.disconnect = mocks.disconnect;
      this.send = mocks.send;
      this.navigate = mocks.navigate;
      this.evaluate = mocks.evaluate;
      this.waitForEvent = mocks.waitForEvent;
      Object.defineProperty(this, "isConnected", {
        get: mocks.isConnected,
      });
    }),
    discoverTargets: vi.fn(),
  };
});

import { discoverTargets } from "../cdp/index.js";

const mockedDiscoverTargets = vi.mocked(discoverTargets);

function makeTarget(overrides: Partial<CdpTarget>): CdpTarget {
  return {
    description: "",
    devtoolsFrontendUrl: "",
    id: "DEFAULT",
    title: "Test",
    type: "page",
    url: "about:blank",
    webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/page/DEFAULT",
    ...overrides,
  };
}

const LINKEDIN_TARGET = makeTarget({
  id: "LI1",
  url: "https://www.linkedin.com/feed/",
  title: "LinkedIn Feed",
});

const UI_TARGET = makeTarget({
  id: "UI1",
  url: "chrome-extension://abc/index.html#/",
  title: "LinkedHelper",
});

function getClientMocks(targetId: string): ClientMocks {
  const mocks = clientsByTargetId.get(targetId);
  if (!mocks) {
    throw new Error(`No CDPClient mock found for target ${targetId}`);
  }
  return mocks;
}

beforeEach(() => {
  clientInstances = [];
  clientsByTargetId = new Map();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("InstanceService", () => {
  let service: InstanceService;

  beforeEach(() => {
    service = new InstanceService(9223);
  });

  describe("connect", () => {
    it("discovers targets and connects to both on first poll", async () => {
      mockedDiscoverTargets.mockResolvedValue([LINKEDIN_TARGET, UI_TARGET]);

      await service.connect();

      expect(service.isConnected).toBe(true);
      expect(clientInstances).toHaveLength(2);
      expect(clientsByTargetId.has("LI1")).toBe(true);
      expect(clientsByTargetId.has("UI1")).toBe(true);
    });

    it("polls until both targets appear", async () => {
      vi.useFakeTimers();

      mockedDiscoverTargets
        .mockResolvedValueOnce([UI_TARGET])
        .mockResolvedValueOnce([UI_TARGET])
        .mockResolvedValue([LINKEDIN_TARGET, UI_TARGET]);

      const connectPromise = service.connect();
      await vi.advanceTimersByTimeAsync(5_000);
      await connectPromise;

      expect(service.isConnected).toBe(true);
      expect(mockedDiscoverTargets.mock.calls.length).toBeGreaterThanOrEqual(3);

      vi.useRealTimers();
    });

    it("throws InstanceNotRunningError when no LinkedIn target", async () => {
      vi.useFakeTimers();

      mockedDiscoverTargets.mockResolvedValue([UI_TARGET]);

      const promise = service.connect();
      const assertion = expect(promise).rejects.toThrow(
        /LinkedIn webview target not found/,
      );
      await vi.advanceTimersByTimeAsync(31_000);
      await assertion;

      vi.useRealTimers();
    });

    it("throws InstanceNotRunningError when no UI target", async () => {
      vi.useFakeTimers();

      mockedDiscoverTargets.mockResolvedValue([LINKEDIN_TARGET]);

      const promise = service.connect();
      const assertion = expect(promise).rejects.toThrow(
        /Instance UI target not found/,
      );
      await vi.advanceTimersByTimeAsync(31_000);
      await assertion;

      vi.useRealTimers();
    });

    it("throws InstanceNotRunningError when no targets at all", async () => {
      vi.useFakeTimers();

      mockedDiscoverTargets.mockResolvedValue([]);

      const promise = service.connect();
      const assertion = expect(promise).rejects.toThrow(
        /LinkedIn webview target not found.*0 CDP target/,
      );
      await vi.advanceTimersByTimeAsync(31_000);
      await assertion;

      vi.useRealTimers();
    });
  });

  describe("connectUiOnly", () => {
    it("connects to UI target only when both targets exist", async () => {
      mockedDiscoverTargets.mockResolvedValue([LINKEDIN_TARGET, UI_TARGET]);

      await service.connectUiOnly();

      expect(clientInstances).toHaveLength(1);
      expect(clientsByTargetId.has("UI1")).toBe(true);
      expect(clientsByTargetId.has("LI1")).toBe(false);
    });

    it("connects when only UI target exists", async () => {
      mockedDiscoverTargets.mockResolvedValue([UI_TARGET]);

      await service.connectUiOnly();

      expect(clientInstances).toHaveLength(1);
      expect(clientsByTargetId.has("UI1")).toBe(true);
    });

    it("evaluateUI works after connectUiOnly", async () => {
      mockedDiscoverTargets.mockResolvedValue([UI_TARGET]);
      await service.connectUiOnly();

      const uiClient = getClientMocks("UI1");
      uiClient.evaluate.mockResolvedValueOnce("ok");

      const result = await service.evaluateUI("expr");

      expect(result).toBe("ok");
      expect(uiClient.evaluate).toHaveBeenCalledWith("expr", true);
    });

    it("ensureLinkedInClient throws ServiceError after connectUiOnly", async () => {
      mockedDiscoverTargets.mockResolvedValue([UI_TARGET]);
      await service.connectUiOnly();

      await expect(
        service.navigateLinkedIn("https://www.linkedin.com/feed/"),
      ).rejects.toThrow(ServiceError);
    });

    it("polls until UI target appears", async () => {
      vi.useFakeTimers();

      mockedDiscoverTargets
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValue([UI_TARGET]);

      const connectPromise = service.connectUiOnly();
      await vi.advanceTimersByTimeAsync(5_000);
      await connectPromise;

      expect(clientsByTargetId.has("UI1")).toBe(true);
      expect(mockedDiscoverTargets.mock.calls.length).toBeGreaterThanOrEqual(3);

      vi.useRealTimers();
    });

    it("throws InstanceNotRunningError when no UI target after timeout", async () => {
      vi.useFakeTimers();

      mockedDiscoverTargets.mockResolvedValue([LINKEDIN_TARGET]);

      const promise = service.connectUiOnly();
      const assertion = expect(promise).rejects.toThrow(
        /Instance UI target not found/,
      );
      await vi.advanceTimersByTimeAsync(31_000);
      await assertion;

      vi.useRealTimers();
    });

    it("throws InstanceNotRunningError when no targets at all", async () => {
      vi.useFakeTimers();

      mockedDiscoverTargets.mockResolvedValue([]);

      const promise = service.connectUiOnly();
      const assertion = expect(promise).rejects.toThrow(
        /Instance UI target not found.*0 CDP target/,
      );
      await vi.advanceTimersByTimeAsync(31_000);
      await assertion;

      vi.useRealTimers();
    });

    it("isConnected returns false after connectUiOnly", async () => {
      mockedDiscoverTargets.mockResolvedValue([UI_TARGET]);
      await service.connectUiOnly();

      expect(service.isConnected).toBe(false);
    });
  });

  describe("disconnect", () => {
    it("disconnects both clients", async () => {
      mockedDiscoverTargets.mockResolvedValue([LINKEDIN_TARGET, UI_TARGET]);
      await service.connect();

      service.disconnect();

      const liClient = getClientMocks("LI1");
      const uiClient = getClientMocks("UI1");
      expect(liClient.disconnect).toHaveBeenCalledTimes(1);
      expect(uiClient.disconnect).toHaveBeenCalledTimes(1);
    });

    it("does not throw when not connected", () => {
      expect(() => service.disconnect()).not.toThrow();
    });
  });

  describe("executeAction", () => {
    it("evaluates the given action on the UI client only", async () => {
      mockedDiscoverTargets.mockResolvedValue([LINKEDIN_TARGET, UI_TARGET]);
      await service.connect();

      await service.executeAction("ScrapeMessagingHistory");

      const liClient = getClientMocks("LI1");
      const uiClient = getClientMocks("UI1");

      expect(uiClient.evaluate).toHaveBeenCalledWith(
        expect.stringContaining("ScrapeMessagingHistory"),
        true,
      );
      expect(liClient.evaluate).not.toHaveBeenCalled();
    });

    it("passes config to the action", async () => {
      mockedDiscoverTargets.mockResolvedValue([LINKEDIN_TARGET, UI_TARGET]);
      await service.connect();

      await service.executeAction("SomeAction", { key: "value" });

      const uiClient = getClientMocks("UI1");
      const script = uiClient.evaluate.mock.calls[0]?.[0] as string;
      expect(script).toContain('"SomeAction"');
      expect(script).toContain('"key"');
      expect(script).toContain('"value"');
    });

    it("returns ActionResult with success on completion", async () => {
      mockedDiscoverTargets.mockResolvedValue([LINKEDIN_TARGET, UI_TARGET]);
      await service.connect();

      const result = await service.executeAction("ScrapeMessagingHistory");

      expect(result).toEqual({
        success: true,
        actionType: "ScrapeMessagingHistory",
      });
    });

    it("throws ActionExecutionError when evaluation fails", async () => {
      mockedDiscoverTargets.mockResolvedValue([LINKEDIN_TARGET, UI_TARGET]);
      await service.connect();

      const uiClient = getClientMocks("UI1");
      const cause = new Error("mainWindowService not found on window");
      uiClient.evaluate.mockRejectedValueOnce(cause);

      const error = await service.executeAction("BadAction").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ActionExecutionError);
      expect(error).toMatchObject({
        actionType: "BadAction",
        message: expect.stringContaining("mainWindowService not found"),
      });
      expect((error as ActionExecutionError).cause).toBe(cause);
    });

    it("throws ServiceError when not connected", async () => {
      await expect(service.executeAction("SomeAction")).rejects.toThrow(
        ServiceError,
      );
    });
  });

  describe("navigateLinkedIn", () => {
    it("enables Page domain, navigates via evaluate, waits for load, then disables", async () => {
      mockedDiscoverTargets.mockResolvedValue([LINKEDIN_TARGET, UI_TARGET]);
      await service.connect();

      const liClient = getClientMocks("LI1");

      await service.navigateLinkedIn("https://www.linkedin.com/search/results/people/");

      expect(liClient.send).toHaveBeenCalledWith("Page.enable");
      expect(liClient.evaluate).toHaveBeenCalledWith(
        `void (window.location.href = "https://www.linkedin.com/search/results/people/")`,
      );
      expect(liClient.navigate).not.toHaveBeenCalled();
      expect(liClient.waitForEvent).toHaveBeenCalledWith("Page.loadEventFired");
      expect(liClient.send).toHaveBeenCalledWith("Page.disable");
    });

    it("disables Page domain even when navigation fails", async () => {
      mockedDiscoverTargets.mockResolvedValue([LINKEDIN_TARGET, UI_TARGET]);
      await service.connect();

      const liClient = getClientMocks("LI1");
      liClient.evaluate.mockRejectedValueOnce(new Error("navigation failed"));

      await expect(
        service.navigateLinkedIn("https://www.linkedin.com/search/results/people/"),
      ).rejects.toThrow("navigation failed");

      expect(liClient.send).toHaveBeenCalledWith("Page.disable");
    });

    it("does not use the UI client", async () => {
      mockedDiscoverTargets.mockResolvedValue([LINKEDIN_TARGET, UI_TARGET]);
      await service.connect();

      await service.navigateLinkedIn("https://www.linkedin.com/search/results/people/");

      const uiClient = getClientMocks("UI1");
      expect(uiClient.evaluate).not.toHaveBeenCalled();
      expect(uiClient.send).not.toHaveBeenCalled();
    });

    it("throws ServiceError when not connected", async () => {
      await expect(
        service.navigateLinkedIn("https://www.linkedin.com/search/results/people/"),
      ).rejects.toThrow(ServiceError);
    });

    it("rejects non-http/https URL schemes", async () => {
      mockedDiscoverTargets.mockResolvedValue([LINKEDIN_TARGET, UI_TARGET]);
      await service.connect();

      await expect(
        service.navigateLinkedIn("javascript:alert(1)"),
      ).rejects.toThrow(TypeError);

      await expect(
        service.navigateLinkedIn("file:///etc/passwd"),
      ).rejects.toThrow(TypeError);

      await expect(
        service.navigateLinkedIn("data:text/html,<h1>test</h1>"),
      ).rejects.toThrow(TypeError);
    });
  });

  describe("getInstancePopups", () => {
    it("returns empty array when no popups found", async () => {
      mockedDiscoverTargets.mockResolvedValue([LINKEDIN_TARGET, UI_TARGET]);
      await service.connect();

      const uiClient = getClientMocks("UI1");
      uiClient.evaluate.mockResolvedValueOnce([]);

      const result = await service.getInstancePopups();

      expect(result).toEqual([]);
      expect(uiClient.evaluate).toHaveBeenCalledTimes(1);
      const call = uiClient.evaluate.mock.calls[0];
      expect(call).toBeDefined();
      expect(call?.[0]).toContain("Popup_Header_");
      expect(call?.[0]).toContain('[role="dialog"]');
      expect(call?.[1]).toBe(false);
    });

    it("returns detected popups with title and description", async () => {
      mockedDiscoverTargets.mockResolvedValue([LINKEDIN_TARGET, UI_TARGET]);
      await service.connect();

      const uiClient = getClientMocks("UI1");
      uiClient.evaluate.mockResolvedValueOnce([
        {
          title: "Failed to initialize UI",
          description: "AsyncHandlerError: liAccount not initialized",
          closable: true,
        },
      ]);

      const result = await service.getInstancePopups();

      expect(result).toEqual([
        {
          title: "Failed to initialize UI",
          description: "AsyncHandlerError: liAccount not initialized",
          closable: true,
        },
      ]);
    });

    it("returns multiple popups", async () => {
      mockedDiscoverTargets.mockResolvedValue([LINKEDIN_TARGET, UI_TARGET]);
      await service.connect();

      const uiClient = getClientMocks("UI1");
      uiClient.evaluate.mockResolvedValueOnce([
        { title: "Error 1", description: "Details 1", closable: true },
        { title: "Error 2", closable: false },
      ]);

      const result = await service.getInstancePopups();

      expect(result).toHaveLength(2);
      expect(result[0]?.title).toBe("Error 1");
      expect(result[1]?.title).toBe("Error 2");
      expect(result[1]?.description).toBeUndefined();
      expect(result[1]?.closable).toBe(false);
    });

    it("throws ServiceError when not connected", async () => {
      await expect(service.getInstancePopups()).rejects.toThrow(ServiceError);
    });

    it("propagates errors from CDP client", async () => {
      mockedDiscoverTargets.mockResolvedValue([LINKEDIN_TARGET, UI_TARGET]);
      await service.connect();

      const uiClient = getClientMocks("UI1");
      uiClient.evaluate.mockRejectedValueOnce(new Error("CDP evaluation failed"));

      await expect(service.getInstancePopups()).rejects.toThrow("CDP evaluation failed");
    });

    it("evaluates on the UI client only", async () => {
      mockedDiscoverTargets.mockResolvedValue([LINKEDIN_TARGET, UI_TARGET]);
      await service.connect();

      const uiClient = getClientMocks("UI1");
      uiClient.evaluate.mockResolvedValueOnce([]);

      await service.getInstancePopups();

      const liClient = getClientMocks("LI1");
      expect(liClient.evaluate).not.toHaveBeenCalled();
    });
  });

  describe("evaluateUI", () => {
    it("evaluates expression on the UI client only", async () => {
      mockedDiscoverTargets.mockResolvedValue([LINKEDIN_TARGET, UI_TARGET]);
      await service.connect();

      const uiClient = getClientMocks("UI1");
      uiClient.evaluate.mockResolvedValueOnce({ result: 42 });

      const result = await service.evaluateUI("1 + 1");

      expect(uiClient.evaluate).toHaveBeenCalledWith("1 + 1", true);
      expect(result).toEqual({ result: 42 });

      const liClient = getClientMocks("LI1");
      expect(liClient.evaluate).not.toHaveBeenCalled();
    });

    it("defaults awaitPromise to true", async () => {
      mockedDiscoverTargets.mockResolvedValue([LINKEDIN_TARGET, UI_TARGET]);
      await service.connect();

      await service.evaluateUI("expr");

      const uiClient = getClientMocks("UI1");
      expect(uiClient.evaluate).toHaveBeenCalledWith("expr", true);
    });

    it("respects awaitPromise=false", async () => {
      mockedDiscoverTargets.mockResolvedValue([LINKEDIN_TARGET, UI_TARGET]);
      await service.connect();

      await service.evaluateUI("expr", false);

      const uiClient = getClientMocks("UI1");
      expect(uiClient.evaluate).toHaveBeenCalledWith("expr", false);
    });

    it("throws ServiceError when not connected", async () => {
      await expect(service.evaluateUI("expr")).rejects.toThrow(ServiceError);
    });

    it("propagates errors from CDP client", async () => {
      mockedDiscoverTargets.mockResolvedValue([LINKEDIN_TARGET, UI_TARGET]);
      await service.connect();

      const uiClient = getClientMocks("UI1");
      uiClient.evaluate.mockRejectedValueOnce(new Error("CDP failure"));

      await expect(service.evaluateUI("bad")).rejects.toThrow("CDP failure");
    });
  });

});
