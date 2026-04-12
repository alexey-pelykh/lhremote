// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lhremote/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lhremote/core")>();
  return {
    ...actual,
    LauncherService: vi.fn(),
    resolveAppPort: vi.fn(),
  };
});

import {
  LauncherService,
  LinkedHelperNotRunningError,
  resolveAppPort,
  type Workspace,
} from "@lhremote/core";

import { handleListWorkspaces } from "./list-workspaces.js";
import { mockLauncher } from "./testing/mock-helpers.js";

const SAMPLE_WORKSPACES: Workspace[] = [
  {
    id: 473509,
    name: "Personal workspace",
    deleted: false,
    workspaceUser: {
      id: 518351,
      userId: 438509,
      workspaceId: 473509,
      role: "owner",
      deleted: false,
    },
    selected: false,
  },
  {
    id: 20338,
    name: "PELYKH Consulting",
    deleted: false,
    workspaceUser: {
      id: 33440,
      userId: 438509,
      workspaceId: 20338,
      role: "admin",
      deleted: false,
    },
    selected: true,
  },
];

describe("handleListWorkspaces", () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
    vi.clearAllMocks();
    vi.mocked(resolveAppPort).mockResolvedValue(9222);
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("prints JSON array with --json", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    mockLauncher({
      listWorkspaces: vi.fn().mockResolvedValue(SAMPLE_WORKSPACES),
    });

    await handleListWorkspaces({ json: true });

    const firstCall = stdoutSpy.mock.calls[0] as [string];
    expect(JSON.parse(firstCall[0])).toEqual(SAMPLE_WORKSPACES);
  });

  it("prints marker and role in the default formatted table", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    mockLauncher({
      listWorkspaces: vi.fn().mockResolvedValue(SAMPLE_WORKSPACES),
    });

    await handleListWorkspaces({});

    const writes = stdoutSpy.mock.calls.map((c) => c[0] as string);
    expect(writes).toContain("  473509\tPersonal workspace\t[owner]\n");
    expect(writes).toContain("* 20338\tPELYKH Consulting\t[admin]\n");
  });

  it("prints message when no workspaces", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    mockLauncher({ listWorkspaces: vi.fn().mockResolvedValue([]) });

    await handleListWorkspaces({});

    expect(stdoutSpy).toHaveBeenCalledWith("No workspaces found\n");
  });

  it("sets exitCode 1 when not running", async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockReturnValue(true);

    vi.mocked(LauncherService).mockImplementation(function () {
      return {
        connect: vi
          .fn()
          .mockRejectedValue(new LinkedHelperNotRunningError(9222)),
        disconnect: vi.fn(),
      } as unknown as LauncherService;
    });

    await handleListWorkspaces({});

    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalled();
  });

  it("disconnects after successful call", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);

    const { disconnect } = mockLauncher({
      listWorkspaces: vi.fn().mockResolvedValue([]),
    });

    await handleListWorkspaces({});

    expect(disconnect).toHaveBeenCalledOnce();
  });
});
