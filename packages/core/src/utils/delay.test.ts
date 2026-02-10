import { describe, expect, it } from "vitest";
import { delay } from "./delay.js";

describe("delay", () => {
  it("should resolve after the given time", async () => {
    const start = Date.now();
    await delay(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });

  it("should return a promise that resolves to undefined", async () => {
    const result = await delay(0);
    expect(result).toBeUndefined();
  });
});
