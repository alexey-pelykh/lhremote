import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LinkedHelperNotRunningError,
  ServiceError,
  StartInstanceError,
} from "./errors.js";
import { LauncherService } from "./launcher.js";

/**
 * Shared CDPClient mocks — LauncherService creates exactly one CDPClient,
 * so per-instance isolation (as in instance.test.ts) is unnecessary here.
 */
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockEvaluate = vi.fn();
const mockIsConnected = vi.fn().mockReturnValue(true);

vi.mock("../cdp/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../cdp/index.js")>();
  return {
    CDPClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      this.connect = mockConnect;
      this.disconnect = mockDisconnect;
      this.evaluate = mockEvaluate;
      Object.defineProperty(this, "isConnected", {
        get: mockIsConnected,
      });
    }),
    CDPConnectionError: original.CDPConnectionError,
  };
});

import { CDPConnectionError } from "../cdp/index.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LauncherService", () => {
  let service: LauncherService;

  beforeEach(() => {
    service = new LauncherService(9222);
    mockConnect.mockResolvedValue(undefined);
    mockEvaluate.mockResolvedValue(undefined);
  });

  describe("connect", () => {
    it("creates a CDPClient and connects", async () => {
      await service.connect();

      expect(service.isConnected).toBe(true);
    });

    it("wraps CDPConnectionError into LinkedHelperNotRunningError", async () => {
      mockConnect.mockRejectedValue(
        new CDPConnectionError("connection refused"),
      );

      await expect(service.connect()).rejects.toThrow(
        LinkedHelperNotRunningError,
      );
    });

    it("re-throws non-CDP errors as-is", async () => {
      mockConnect.mockRejectedValue(new TypeError("unexpected"));

      await expect(service.connect()).rejects.toThrow(TypeError);
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
      mockEvaluate.mockResolvedValue({ success: true });

      await service.startInstance(42);

      expect(mockEvaluate).toHaveBeenCalledWith(
        expect.stringContaining("startInstance"),
        true,
      );
      expect(mockEvaluate).toHaveBeenCalledWith(
        expect.stringContaining("42"),
        true,
      );
    });

    it("throws StartInstanceError on failure", async () => {
      await service.connect();
      mockEvaluate.mockResolvedValue({
        success: false,
        error: "account is already running",
      });

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
      );
    });

    it("throws ServiceError when not connected", async () => {
      await expect(service.stopInstance(42)).rejects.toThrow(ServiceError);
    });
  });

  describe("getInstanceStatus", () => {
    it("returns the instance status", async () => {
      await service.connect();
      mockEvaluate.mockResolvedValue("running");

      const status = await service.getInstanceStatus(42);

      expect(status).toBe("running");
    });

    it("returns stopped when status is null", async () => {
      await service.connect();
      mockEvaluate.mockResolvedValue("stopped");

      const status = await service.getInstanceStatus(42);

      expect(status).toBe("stopped");
    });
  });

  describe("listAccounts", () => {
    it("returns parsed accounts", async () => {
      await service.connect();
      mockEvaluate.mockResolvedValue([
        { id: 1, liId: 100, name: "Alice", email: "alice@test.com" },
        { id: 2, liId: 200, name: "Bob" },
      ]);

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
      mockEvaluate.mockResolvedValue(null);

      const accounts = await service.listAccounts();

      expect(accounts).toEqual([]);
    });
  });
});
