import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createProgram } from "./program.js";

describe("createProgram", () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("creates a program named lhremote", () => {
    const program = createProgram();
    expect(program.name()).toBe("lhremote");
  });

  it("reads version from package.json", () => {
    const program = createProgram();
    expect(program.version()).toBe("0.0.0");
  });

  it("registers all expected subcommands", () => {
    const program = createProgram();
    const commandNames = program.commands.map((c) => c.name());

    expect(commandNames).toContain("launch-app");
    expect(commandNames).toContain("quit-app");
    expect(commandNames).toContain("list-accounts");
    expect(commandNames).toContain("start-instance");
    expect(commandNames).toContain("stop-instance");
    expect(commandNames).toContain("visit-and-extract");
    expect(commandNames).toContain("check-status");
    expect(commandNames).toHaveLength(7);
  });

  describe("launch-app", () => {
    it("accepts --cdp-port option", () => {
      const program = createProgram();
      const cmd = program.commands.find((c) => c.name() === "launch-app");
      const portOption = cmd?.options.find((o) => o.long === "--cdp-port");

      expect(portOption).toBeDefined();
    });

    it("sets exitCode 1 (stub)", async () => {
      vi.spyOn(process.stderr, "write").mockReturnValue(true);

      const program = createProgram();
      program.exitOverride();
      await program.parseAsync(["node", "lhremote", "launch-app"]);

      expect(process.exitCode).toBe(1);
    });
  });

  describe("list-accounts", () => {
    it("accepts --json option", () => {
      const program = createProgram();
      const cmd = program.commands.find((c) => c.name() === "list-accounts");
      const jsonOption = cmd?.options.find((o) => o.long === "--json");

      expect(jsonOption).toBeDefined();
    });
  });

  describe("start-instance", () => {
    it("requires accountId argument", () => {
      const program = createProgram();
      const cmd = program.commands.find((c) => c.name() === "start-instance");
      const args = cmd?.registeredArguments;

      expect(args).toHaveLength(1);
      expect(args?.[0]?.required).toBe(true);
    });

    it("rejects non-numeric accountId", async () => {
      vi.spyOn(process.stderr, "write").mockReturnValue(true);

      const program = createProgram();
      program.exitOverride().configureOutput({ writeErr: () => {} });

      await expect(
        program.parseAsync(["node", "lhremote", "start-instance", "abc"]),
      ).rejects.toThrow();
    });
  });

  describe("visit-and-extract", () => {
    it("requires profileUrl argument and accepts --json", () => {
      const program = createProgram();
      const cmd = program.commands.find(
        (c) => c.name() === "visit-and-extract",
      );
      const args = cmd?.registeredArguments;
      const jsonOption = cmd?.options.find((o) => o.long === "--json");

      expect(args).toHaveLength(1);
      expect(args?.[0]?.required).toBe(true);
      expect(jsonOption).toBeDefined();
    });
  });

  describe("check-status", () => {
    it("accepts --json option", () => {
      const program = createProgram();
      const cmd = program.commands.find((c) => c.name() === "check-status");
      const jsonOption = cmd?.options.find((o) => o.long === "--json");

      expect(jsonOption).toBeDefined();
    });

    it("sets exitCode 1 (stub)", async () => {
      vi.spyOn(process.stderr, "write").mockReturnValue(true);

      const program = createProgram();
      program.exitOverride();
      await program.parseAsync(["node", "lhremote", "check-status"]);

      expect(process.exitCode).toBe(1);
    });
  });
});
