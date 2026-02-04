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

vi.mock("../cdp/index.js", () => ({
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
}));

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

  describe("navigateToProfile", () => {
    it("calls Page.enable, navigate, and waitForEvent on the LinkedIn client", async () => {
      mockedDiscoverTargets.mockResolvedValue([LINKEDIN_TARGET, UI_TARGET]);
      await service.connect();

      await service.navigateToProfile("https://www.linkedin.com/in/test-user");

      const liClient = getClientMocks("LI1");
      const uiClient = getClientMocks("UI1");

      // LinkedIn client should have received navigation calls
      expect(liClient.send).toHaveBeenCalledWith("Page.enable");
      expect(liClient.navigate).toHaveBeenCalledWith(
        "https://www.linkedin.com/in/test-user",
      );
      expect(liClient.waitForEvent).toHaveBeenCalledWith("Page.loadEventFired");

      // UI client should NOT have received any navigation calls
      expect(uiClient.send).not.toHaveBeenCalled();
      expect(uiClient.navigate).not.toHaveBeenCalled();
      expect(uiClient.waitForEvent).not.toHaveBeenCalled();
    });

    it("throws ServiceError when not connected", async () => {
      await expect(
        service.navigateToProfile("https://www.linkedin.com/in/test"),
      ).rejects.toThrow(ServiceError);
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

  describe("triggerExtraction", () => {
    it("delegates to executeAction with SaveCurrentProfile", async () => {
      mockedDiscoverTargets.mockResolvedValue([LINKEDIN_TARGET, UI_TARGET]);
      await service.connect();

      await service.triggerExtraction();

      const uiClient = getClientMocks("UI1");

      expect(uiClient.evaluate).toHaveBeenCalledWith(
        expect.stringContaining("SaveCurrentProfile"),
        true,
      );
    });

    it("throws ServiceError when not connected", async () => {
      await expect(service.triggerExtraction()).rejects.toThrow(
        ServiceError,
      );
    });
  });
});
