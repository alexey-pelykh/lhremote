// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LinkedHelperNotRunningError,
  NodeIntegrationUnavailableError,
  ServiceError,
  StartInstanceError,
  WrongPortError,
} from "./errors.js";
import { LauncherService } from "./launcher.js";

/**
 * Shared CDPClient mocks — LauncherService creates exactly one CDPClient,
 * so per-instance isolation (as in instance.test.ts) is unnecessary here.
 */
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockEvaluate = vi.fn();
const mockSend = vi.fn();
const mockOn = vi.fn();
const mockOff = vi.fn();
const mockIsConnected = vi.fn().mockReturnValue(true);

vi.mock("../cdp/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../cdp/index.js")>();
  return {
    CDPClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      this.connect = mockConnect;
      this.disconnect = mockDisconnect;
      this.evaluate = mockEvaluate;
      this.send = mockSend;
      this.on = mockOn;
      this.off = mockOff;
      Object.defineProperty(this, "isConnected", {
        get: mockIsConnected,
      });
    }),
    CDPConnectionError: original.CDPConnectionError,
    CDPEvaluationError: original.CDPEvaluationError,
    findApp: vi.fn(),
  };
});

import { CDPConnectionError, CDPEvaluationError, findApp } from "../cdp/index.js";

const mockFindApp = vi.mocked(findApp);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LauncherService", () => {
  let service: LauncherService;

  /** Value returned by the next non-probe evaluate call. */
  let nextEvaluateResult: unknown = undefined;

  beforeEach(() => {
    service = new LauncherService(9222);
    mockConnect.mockResolvedValue(undefined);
    nextEvaluateResult = undefined;

    // Default: require is available in the default context.
    // The probe call returns true; all other calls return nextEvaluateResult.
    mockEvaluate.mockImplementation((expression: string) => {
      if (expression === "typeof require === 'function'") {
        return Promise.resolve(true);
      }
      return Promise.resolve(nextEvaluateResult);
    });
  });

  describe("connect", () => {
    it("creates a CDPClient and connects", async () => {
      await service.connect();

      expect(service.isConnected).toBe(true);
    });

    it("probes for require availability during connect", async () => {
      await service.connect();

      expect(mockEvaluate).toHaveBeenCalledWith(
        "typeof require === 'function'",
      );
    });

    it("wraps CDPConnectionError into LinkedHelperNotRunningError", async () => {
      mockConnect.mockRejectedValue(
        new CDPConnectionError("connection refused"),
      );
      mockFindApp.mockResolvedValue([]);

      await expect(service.connect()).rejects.toThrow(
        LinkedHelperNotRunningError,
      );
    });

    it("re-throws non-CDP errors as-is", async () => {
      mockConnect.mockRejectedValue(new TypeError("unexpected"));

      await expect(service.connect()).rejects.toThrow(TypeError);
    });
  });

  describe("connect with context fallback", () => {
    it("falls back to preload context when default lacks require", async () => {
      let probeCount = 0;
      mockEvaluate.mockImplementation((expression: string, _await?: boolean, contextId?: number) => {
        if (expression === "typeof require === 'function'") {
          probeCount++;
          // First probe (default context): no require
          // Second probe (preload context id=2): has require
          return Promise.resolve(probeCount >= 2 && contextId === 2);
        }
        return Promise.resolve(undefined);
      });

      mockOn.mockImplementation((event: string, handler: (params: unknown) => void) => {
        if (event === "Runtime.executionContextCreated") {
          handler({ context: { id: 1, auxData: { isDefault: true } } });
          handler({ context: { id: 2, auxData: { isDefault: false } } });
        }
      });
      mockSend.mockResolvedValue(undefined);

      await service.connect();

      expect(service.isConnected).toBe(true);
      expect(mockSend).toHaveBeenCalledWith("Runtime.enable");
      expect(mockSend).toHaveBeenCalledWith("Runtime.disable");
    });

    it("throws NodeIntegrationUnavailableError when no context has require", async () => {
      mockEvaluate.mockImplementation((expression: string) => {
        if (expression === "typeof require === 'function'") {
          return Promise.resolve(false);
        }
        return Promise.resolve(undefined);
      });

      mockOn.mockImplementation((event: string, handler: (params: unknown) => void) => {
        if (event === "Runtime.executionContextCreated") {
          handler({ context: { id: 1, auxData: { isDefault: true } } });
          handler({ context: { id: 2, auxData: { isDefault: false } } });
        }
      });
      mockSend.mockResolvedValue(undefined);

      await expect(service.connect()).rejects.toThrow(
        NodeIntegrationUnavailableError,
      );
    });

    it("uses preload context for subsequent evaluations", async () => {
      const PRELOAD_CONTEXT_ID = 42;
      let probeCount = 0;

      mockEvaluate.mockImplementation((expression: string, _await?: boolean, contextId?: number) => {
        if (expression === "typeof require === 'function'") {
          probeCount++;
          return Promise.resolve(probeCount >= 2 && contextId === PRELOAD_CONTEXT_ID);
        }
        return Promise.resolve(nextEvaluateResult);
      });

      mockOn.mockImplementation((event: string, handler: (params: unknown) => void) => {
        if (event === "Runtime.executionContextCreated") {
          handler({ context: { id: 1, auxData: { isDefault: true } } });
          handler({ context: { id: PRELOAD_CONTEXT_ID, auxData: { isDefault: false } } });
        }
      });
      mockSend.mockResolvedValue(undefined);

      await service.connect();

      nextEvaluateResult = [];
      await service.listAccounts();

      const calls = mockEvaluate.mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall).toBeDefined();
      expect(lastCall?.[2]).toBe(PRELOAD_CONTEXT_ID);
    });
  });

  describe("disconnect", () => {
    it("disconnects the CDPClient", async () => {
      await service.connect();
      service.disconnect();

      expect(mockDisconnect).toHaveBeenCalled();
    });

    it("does not throw when not connected", () => {
      expect(() => service.disconnect()).not.toThrow();
    });
  });

  describe("startInstance", () => {
    it("evaluates the startInstance expression", async () => {
      await service.connect();
      nextEvaluateResult = { success: true };

      await service.startInstance(42);

      expect(mockEvaluate).toHaveBeenCalledWith(
        expect.stringContaining("startInstance"),
        true,
        undefined,
      );
      expect(mockEvaluate).toHaveBeenCalledWith(
        expect.stringContaining("42"),
        true,
        undefined,
      );
    });

    it("throws StartInstanceError on failure", async () => {
      await service.connect();
      nextEvaluateResult = {
        success: false,
        error: "account is already running",
      };

      await expect(service.startInstance(42)).rejects.toThrow(
        StartInstanceError,
      );
      await expect(service.startInstance(42)).rejects.toThrow(
        /account is already running/,
      );
    });

    it("throws ServiceError when not connected", async () => {
      await expect(service.startInstance(42)).rejects.toThrow(ServiceError);
    });
  });

  describe("stopInstance", () => {
    it("evaluates the stopInstance expression", async () => {
      await service.connect();

      await service.stopInstance(42);

      expect(mockEvaluate).toHaveBeenCalledWith(
        expect.stringContaining("stopInstance"),
        true,
        undefined,
      );
    });

    it("throws ServiceError when not connected", async () => {
      await expect(service.stopInstance(42)).rejects.toThrow(ServiceError);
    });
  });

  describe("getInstanceStatus", () => {
    it("returns the instance status", async () => {
      await service.connect();
      nextEvaluateResult = "running";

      const status = await service.getInstanceStatus(42);

      expect(status).toBe("running");
    });

    it("returns stopped when status is null", async () => {
      await service.connect();
      nextEvaluateResult = "stopped";

      const status = await service.getInstanceStatus(42);

      expect(status).toBe("stopped");
    });
  });

  describe("listAccounts", () => {
    it("returns parsed accounts", async () => {
      await service.connect();
      nextEvaluateResult = [
        { id: 1, liId: 100, name: "Alice", email: "alice@test.com" },
        { id: 2, liId: 200, name: "Bob" },
      ];

      const accounts = await service.listAccounts();

      expect(accounts).toHaveLength(2);
      expect(accounts).toContainEqual(
        expect.objectContaining({ name: "Alice" }),
      );
      expect(accounts).toContainEqual(
        expect.objectContaining({ name: "Bob" }),
      );
    });

    it("returns empty array when no accounts", async () => {
      await service.connect();
      nextEvaluateResult = [];

      const accounts = await service.listAccounts();

      expect(accounts).toEqual([]);
    });

    it("propagates CDPEvaluationErrors directly", async () => {
      await service.connect();
      mockEvaluate.mockImplementation((expression: string) => {
        if (expression === "typeof require === 'function'") {
          return Promise.resolve(true);
        }
        return Promise.reject(
          new CDPEvaluationError("ReferenceError: remote is not defined"),
        );
      });

      await expect(service.listAccounts()).rejects.toThrow(CDPEvaluationError);
    });

    it("throws WrongPortError when electronStore is not available", async () => {
      await service.connect();
      nextEvaluateResult = null;

      await expect(service.listAccounts()).rejects.toThrow(WrongPortError);
    });
  });
});
