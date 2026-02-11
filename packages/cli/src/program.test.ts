import { createRequire } from "node:module";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createProgram } from "./program.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

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
    expect(program.version()).toBe(version);
  });

  it("registers all expected subcommands", () => {
    const program = createProgram();
    const commandNames = program.commands.map((c) => c.name());

    expect(commandNames).toContain("find-app");
    expect(commandNames).toContain("launch-app");
    expect(commandNames).toContain("quit-app");
    expect(commandNames).toContain("list-accounts");
    expect(commandNames).toContain("start-instance");
    expect(commandNames).toContain("stop-instance");
    expect(commandNames).toContain("query-profile");
    expect(commandNames).toContain("query-profiles");
    expect(commandNames).toContain("query-messages");
    expect(commandNames).toContain("scrape-messaging-history");
    expect(commandNames).toContain("campaign-create");
    expect(commandNames).toContain("campaign-delete");
    expect(commandNames).toContain("campaign-export");
    expect(commandNames).toContain("campaign-get");
    expect(commandNames).toContain("campaign-list");
    expect(commandNames).toContain("campaign-start");
    expect(commandNames).toContain("campaign-status");
    expect(commandNames).toContain("campaign-stop");
    expect(commandNames).toContain("campaign-update");
    expect(commandNames).toContain("check-replies");
    expect(commandNames).toContain("check-status");
    expect(commandNames).toContain("describe-actions");
    expect(commandNames).toContain("import-people-from-urls");
    expect(commandNames).toHaveLength(23);
  });

  describe("launch-app", () => {
    it("accepts --cdp-port option", () => {
      const program = createProgram();
      const cmd = program.commands.find((c) => c.name() === "launch-app");
      const portOption = cmd?.options.find((o) => o.long === "--cdp-port");

      expect(portOption).toBeDefined();
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

  describe("check-status", () => {
    it("accepts --json option", () => {
      const program = createProgram();
      const cmd = program.commands.find((c) => c.name() === "check-status");
      const jsonOption = cmd?.options.find((o) => o.long === "--json");

      expect(jsonOption).toBeDefined();
    });

    it("accepts --cdp-port option", () => {
      const program = createProgram();
      const cmd = program.commands.find((c) => c.name() === "check-status");
      const portOption = cmd?.options.find((o) => o.long === "--cdp-port");

      expect(portOption).toBeDefined();
    });
  });
});
