import { describe, expect, it } from "vitest";
import { errorMessage } from "./error-message.js";

describe("errorMessage", () => {
  it("should extract message from Error instances", () => {
    expect(errorMessage(new Error("something failed"))).toBe(
      "something failed",
    );
  });

  it("should extract message from Error subclasses", () => {
    expect(errorMessage(new TypeError("bad type"))).toBe("bad type");
  });

  it("should convert strings via String()", () => {
    expect(errorMessage("plain string")).toBe("plain string");
  });

  it("should convert numbers via String()", () => {
    expect(errorMessage(42)).toBe("42");
  });

  it("should convert null via String()", () => {
    expect(errorMessage(null)).toBe("null");
  });

  it("should convert undefined via String()", () => {
    expect(errorMessage(undefined)).toBe("undefined");
  });

  it("should convert objects via String()", () => {
    expect(errorMessage({ toString: () => "custom" })).toBe("custom");
  });
});
