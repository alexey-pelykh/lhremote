import { describe, expect, it } from "vitest";
import {
  CDPConnectionError,
  CDPError,
  CDPEvaluationError,
  CDPTimeoutError,
} from "./errors.js";

describe("CDP errors", () => {
  it("should set correct name for CDPError", () => {
    const error = new CDPError("test");
    expect(error.name).toBe("CDPError");
    expect(error.message).toBe("test");
    expect(error).toBeInstanceOf(Error);
  });

  it("should set correct name for CDPConnectionError", () => {
    const error = new CDPConnectionError("connection failed");
    expect(error.name).toBe("CDPConnectionError");
    expect(error.message).toBe("connection failed");
    expect(error).toBeInstanceOf(CDPError);
    expect(error).toBeInstanceOf(Error);
  });

  it("should set correct name for CDPTimeoutError", () => {
    const error = new CDPTimeoutError("timed out");
    expect(error.name).toBe("CDPTimeoutError");
    expect(error.message).toBe("timed out");
    expect(error).toBeInstanceOf(CDPError);
  });

  it("should set correct name for CDPEvaluationError", () => {
    const error = new CDPEvaluationError("eval failed");
    expect(error.name).toBe("CDPEvaluationError");
    expect(error.message).toBe("eval failed");
    expect(error).toBeInstanceOf(CDPError);
  });

  it("should support cause via ErrorOptions", () => {
    const cause = new TypeError("original");
    const error = new CDPConnectionError("wrapper", { cause });
    expect(error.cause).toBe(cause);
  });
});
