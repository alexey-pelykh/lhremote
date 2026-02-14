// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Alexey Pelykh

import { describe, expect, it } from "vitest";
import type {
  InstanceInfo,
  InstanceStatus,
  StartInstanceParams,
  StartInstanceResult,
} from "./instance.js";

describe("Instance types", () => {
  it("should allow constructing StartInstanceParams", () => {
    const params: StartInstanceParams = {
      linkedInAccount: { id: 1, liId: 100 },
      accountData: { id: 1, liId: 100 },
      instanceId: 42,
      proxy: null,
      license: null,
      userId: null,
      frontendSettings: {},
      lhAccount: {},
      zoomDefault: 1,
      shouldBringToFront: false,
      shouldStartRunningCampaigns: false,
    };

    expect(params.instanceId).toBe(42);
    expect(params.linkedInAccount.liId).toBe(100);
    expect(params.proxy).toBeNull();
  });

  it("should allow a successful StartInstanceResult", () => {
    const result: StartInstanceResult = { success: true };
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("should allow a failed StartInstanceResult", () => {
    const result: StartInstanceResult = {
      success: false,
      error: "account is already running",
    };
    expect(result.success).toBe(false);
    expect(result.error).toBe("account is already running");
  });

  it("should constrain InstanceStatus to known values", () => {
    const statuses: InstanceStatus[] = [
      "stopped",
      "starting",
      "running",
      "stopping",
    ];
    expect(statuses).toHaveLength(4);
  });

  it("should allow InstanceInfo with optional debuggerPort", () => {
    const stopped: InstanceInfo = {
      instanceId: 1,
      status: "stopped",
    };
    expect(stopped.debuggerPort).toBeUndefined();

    const running: InstanceInfo = {
      instanceId: 2,
      status: "running",
      debuggerPort: 9223,
    };
    expect(running.debuggerPort).toBe(9223);
  });
});
