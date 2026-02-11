import { describe, expect, it } from "vitest";
import {
  ActionExecutionError,
  AppLaunchError,
  AppNotFoundError,
  CampaignExecutionError,
  CampaignTimeoutError,
  ExtractionTimeoutError,
  InstanceNotRunningError,
  InvalidProfileUrlError,
  LinkedHelperNotRunningError,
  ServiceError,
  StartInstanceError,
} from "./errors.js";

describe("Service errors", () => {
  it("should set correct name for ServiceError", () => {
    const error = new ServiceError("test");
    expect(error.name).toBe("ServiceError");
    expect(error.message).toBe("test");
    expect(error).toBeInstanceOf(Error);
  });

  it("should support cause via ErrorOptions", () => {
    const cause = new TypeError("original");
    const error = new ServiceError("wrapper", { cause });
    expect(error.cause).toBe(cause);
  });

  it("should set correct name for AppNotFoundError", () => {
    const error = new AppNotFoundError();
    expect(error.name).toBe("AppNotFoundError");
    expect(error.message).toContain("binary not found");
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toBeInstanceOf(Error);
  });

  it("should allow custom message for AppNotFoundError", () => {
    const error = new AppNotFoundError("custom path");
    expect(error.message).toBe("custom path");
  });

  it("should set correct name for AppLaunchError", () => {
    const error = new AppLaunchError("spawn failed");
    expect(error.name).toBe("AppLaunchError");
    expect(error.message).toBe("spawn failed");
    expect(error).toBeInstanceOf(ServiceError);
  });

  it("should support cause for AppLaunchError", () => {
    const cause = new Error("ENOENT");
    const error = new AppLaunchError("spawn failed", { cause });
    expect(error.cause).toBe(cause);
  });

  it("should set correct name for LinkedHelperNotRunningError", () => {
    const error = new LinkedHelperNotRunningError(9222);
    expect(error.name).toBe("LinkedHelperNotRunningError");
    expect(error.message).toContain("9222");
    expect(error).toBeInstanceOf(ServiceError);
  });

  it("should set correct name for StartInstanceError", () => {
    const error = new StartInstanceError(42);
    expect(error.name).toBe("StartInstanceError");
    expect(error.message).toContain("42");
    expect(error).toBeInstanceOf(ServiceError);
  });

  it("should include reason in StartInstanceError", () => {
    const error = new StartInstanceError(42, "account is already running");
    expect(error.message).toContain("account is already running");
  });

  it("should set correct name for InstanceNotRunningError", () => {
    const error = new InstanceNotRunningError();
    expect(error.name).toBe("InstanceNotRunningError");
    expect(error.message).toBe("Instance not running");
    expect(error).toBeInstanceOf(ServiceError);
  });

  it("should allow custom message for InstanceNotRunningError", () => {
    const error = new InstanceNotRunningError("LinkedIn target not found");
    expect(error.message).toBe("LinkedIn target not found");
  });

  it("should set correct name for ActionExecutionError", () => {
    const error = new ActionExecutionError("MessageToPerson");
    expect(error.name).toBe("ActionExecutionError");
    expect(error.actionType).toBe("MessageToPerson");
    expect(error.message).toContain("MessageToPerson");
    expect(error).toBeInstanceOf(ServiceError);
  });

  it("should allow custom message for ActionExecutionError", () => {
    const error = new ActionExecutionError("InMail", "rate limited");
    expect(error.message).toBe("rate limited");
    expect(error.actionType).toBe("InMail");
  });

  it("should support cause via ErrorOptions for ActionExecutionError", () => {
    const cause = new TypeError("CDP failed");
    const error = new ActionExecutionError("InMail", "action failed", { cause });
    expect(error.cause).toBe(cause);
  });

  it("should set correct name for InvalidProfileUrlError", () => {
    const error = new InvalidProfileUrlError("file:///etc/passwd");
    expect(error.name).toBe("InvalidProfileUrlError");
    expect(error.message).toContain("file:///etc/passwd");
    expect(error).toBeInstanceOf(ServiceError);
  });

  it("should set correct name for ExtractionTimeoutError", () => {
    const error = new ExtractionTimeoutError(
      "https://www.linkedin.com/in/test",
      30000,
    );
    expect(error.name).toBe("ExtractionTimeoutError");
    expect(error.message).toContain("30000ms");
    expect(error.message).toContain("linkedin.com/in/test");
    expect(error).toBeInstanceOf(ServiceError);
  });

  it("should set correct name for CampaignExecutionError", () => {
    const error = new CampaignExecutionError("create failed", 42);
    expect(error.name).toBe("CampaignExecutionError");
    expect(error.message).toBe("create failed");
    expect(error.campaignId).toBe(42);
    expect(error).toBeInstanceOf(ServiceError);
  });

  it("should allow CampaignExecutionError without campaignId", () => {
    const error = new CampaignExecutionError("create failed");
    expect(error.campaignId).toBeUndefined();
  });

  it("should support cause for CampaignExecutionError", () => {
    const cause = new Error("CDP timeout");
    const error = new CampaignExecutionError("failed", 1, { cause });
    expect(error.cause).toBe(cause);
  });

  it("should set correct name for CampaignTimeoutError", () => {
    const error = new CampaignTimeoutError("runner did not reach idle", 42);
    expect(error.name).toBe("CampaignTimeoutError");
    expect(error.message).toContain("idle");
    expect(error.campaignId).toBe(42);
    expect(error).toBeInstanceOf(ServiceError);
  });

  it("should allow CampaignTimeoutError without campaignId", () => {
    const error = new CampaignTimeoutError("timeout");
    expect(error.campaignId).toBeUndefined();
  });
});
