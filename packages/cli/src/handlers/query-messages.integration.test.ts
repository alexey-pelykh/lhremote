// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025 Alexey Pelykh

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(
  __dirname,
  "../../../core/src/db/testing/fixture.db",
);

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    discoverAllDatabases: vi.fn(),
  };
});

import { discoverAllDatabases } from "@lhremote/core";

import { handleQueryMessages } from "./query-messages.js";

describe("handleQueryMessages (integration)", () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
    vi.mocked(discoverAllDatabases).mockReturnValue(
      new Map([[1, FIXTURE_PATH]]),
    );
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("outputs JSON conversation list from fixture", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    await handleQueryMessages({ json: true });

    expect(process.exitCode).toBeUndefined();
    const output = stdoutSpy.mock.calls
      .map((call) => String(call[0]))
      .join("");
    const body = JSON.parse(output) as {
      conversations: { id: number; participants: unknown[] }[];
    };
    expect(body.conversations.length).toBeGreaterThanOrEqual(3);
  });

  it("outputs JSON thread from fixture", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    await handleQueryMessages({ chatId: 1, json: true });

    expect(process.exitCode).toBeUndefined();
    const output = stdoutSpy.mock.calls
      .map((call) => String(call[0]))
      .join("");
    const body = JSON.parse(output) as {
      chat: { id: number };
      messages: { sendAt: string }[];
    };
    expect(body.chat.id).toBe(1);
    expect(body.messages.length).toBeGreaterThanOrEqual(3);
  });

  it("outputs JSON search results from fixture", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    await handleQueryMessages({ search: "compiler", json: true });

    expect(process.exitCode).toBeUndefined();
    const output = stdoutSpy.mock.calls
      .map((call) => String(call[0]))
      .join("");
    const body = JSON.parse(output) as {
      messages: { text: string }[];
    };
    expect(body.messages.length).toBeGreaterThanOrEqual(1);
  });

  it("prints human-readable conversation list from fixture", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    await handleQueryMessages({});

    expect(process.exitCode).toBeUndefined();
    const output = stdoutSpy.mock.calls
      .map((call) => String(call[0]))
      .join("");
    expect(output).toContain("Conversations (");
    expect(output).toContain("messages)");
  });

  it("prints human-readable thread from fixture", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    await handleQueryMessages({ chatId: 1 });

    expect(process.exitCode).toBeUndefined();
    const output = stdoutSpy.mock.calls
      .map((call) => String(call[0]))
      .join("");
    expect(output).toContain("Conversation #1 with");
    expect(output).toContain("Ada");
  });

  it("sets exitCode 1 for nonexistent chatId", async () => {
    vi.spyOn(process.stderr, "write").mockReturnValue(true);

    await handleQueryMessages({ chatId: 999 });

    expect(process.exitCode).toBe(1);
  });

  it("filters by personId from fixture", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    await handleQueryMessages({ personId: 1, json: true });

    expect(process.exitCode).toBeUndefined();
    const output = stdoutSpy.mock.calls
      .map((call) => String(call[0]))
      .join("");
    const body = JSON.parse(output) as {
      conversations: { id: number }[];
    };
    expect(body.conversations).toHaveLength(3);
  });
});
