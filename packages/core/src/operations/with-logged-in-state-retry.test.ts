// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./wait-for-logged-in-state.js", () => ({
  waitForLoggedInState: vi.fn().mockResolvedValue(undefined),
  LoggedInStateTimeoutError: class LoggedInStateTimeoutError extends Error {},
}));

vi.mock("../services/instance.js", () => ({
  InstanceService: vi.fn(),
}));

vi.mock("../cdp/index.js", () => ({
  resolveInstancePort: vi.fn().mockImplementation(async (port: number) => port),
}));

import { waitForLoggedInState } from "./wait-for-logged-in-state.js";
import { InstanceService } from "../services/instance.js";
import {
  LoggedInStatePersistedError,
  withLoggedInStateRetry,
  withLoggedInStateRetryAtPort,
} from "./with-logged-in-state-retry.js";

const instance = {} as InstanceService;

describe("withLoggedInStateRetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns op result on first success — no wait, no retry", async () => {
    const op = vi.fn().mockResolvedValue("ok");

    const result = await withLoggedInStateRetry(instance, op);

    expect(result).toBe("ok");
    expect(op).toHaveBeenCalledTimes(1);
    expect(waitForLoggedInState).not.toHaveBeenCalled();
  });

  it("rethrows non-IncorrectContentStateError without waiting", async () => {
    const op = vi.fn().mockRejectedValue(new Error("Some unrelated CDP failure"));

    await expect(withLoggedInStateRetry(instance, op)).rejects.toThrow(
      "Some unrelated CDP failure",
    );

    expect(op).toHaveBeenCalledTimes(1);
    expect(waitForLoggedInState).not.toHaveBeenCalled();
  });

  it("retries once after IncorrectContentStateError and succeeds", async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("Action.IncorrectContentStateError: Incorrect web-page state"),
      )
      .mockResolvedValueOnce("ok");

    const result = await withLoggedInStateRetry(instance, op);

    expect(result).toBe("ok");
    expect(op).toHaveBeenCalledTimes(2);
    expect(waitForLoggedInState).toHaveBeenCalledTimes(1);
    expect(waitForLoggedInState).toHaveBeenCalledWith(instance, { timeout: 60_000 });
  });

  it("recognises the canonical predicate-failure phrasing", async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("state `li-logged-in-loading` is not `LoggedInState`"),
      )
      .mockResolvedValueOnce("ok");

    const result = await withLoggedInStateRetry(instance, op);

    expect(result).toBe("ok");
    expect(waitForLoggedInState).toHaveBeenCalledTimes(1);
  });

  it("recognises the IncorrectStateType class name", async () => {
    const err = new Error("state `li-logged-in-loading` is not `LoggedInState`");
    err.name = "IncorrectStateType";
    const op = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce("ok");

    const result = await withLoggedInStateRetry(instance, op);

    expect(result).toBe("ok");
    expect(waitForLoggedInState).toHaveBeenCalledTimes(1);
  });

  it("throws LoggedInStatePersistedError when retries exhausted", async () => {
    const op = vi.fn().mockRejectedValue(
      new Error("Action.IncorrectContentStateError: Incorrect web-page state"),
    );

    await expect(
      withLoggedInStateRetry(instance, op, { maxRetries: 1 }),
    ).rejects.toBeInstanceOf(LoggedInStatePersistedError);

    expect(op).toHaveBeenCalledTimes(2);
    expect(waitForLoggedInState).toHaveBeenCalledTimes(1);
  });

  it("respects custom maxRetries", async () => {
    const op = vi.fn().mockRejectedValue(
      new Error("Action.IncorrectContentStateError"),
    );

    await expect(
      withLoggedInStateRetry(instance, op, { maxRetries: 3 }),
    ).rejects.toBeInstanceOf(LoggedInStatePersistedError);

    expect(op).toHaveBeenCalledTimes(4);
    expect(waitForLoggedInState).toHaveBeenCalledTimes(3);
  });

  it("forwards waitTimeout to waitForLoggedInState", async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(new Error("Action.IncorrectContentStateError"))
      .mockResolvedValueOnce("ok");

    await withLoggedInStateRetry(instance, op, { waitTimeout: 30_000 });

    expect(waitForLoggedInState).toHaveBeenCalledWith(instance, { timeout: 30_000 });
  });

  it("preserves the original error inside LoggedInStatePersistedError", async () => {
    const original = new Error("Action.IncorrectContentStateError: Incorrect web-page state");
    const op = vi.fn().mockRejectedValue(original);

    try {
      await withLoggedInStateRetry(instance, op, { maxRetries: 1, waitTimeout: 12_345 });
      expect.unreachable("expected LoggedInStatePersistedError");
    } catch (err) {
      expect(err).toBeInstanceOf(LoggedInStatePersistedError);
      const e = err as LoggedInStatePersistedError;
      expect(e.innerError).toBe(original);
      // waitedMs reflects ACTUAL elapsed time across all wait attempts, not
      // the configured deadline.  Mocked waitForLoggedInState resolves
      // immediately, so the elapsed time is small but non-negative.
      expect(e.waitedMs).toBeGreaterThanOrEqual(0);
      expect(e.waitedMs).toBeLessThan(12_345);
    }
  });

  it("propagates errors thrown by waitForLoggedInState", async () => {
    const gateError = new Error("gate timed out");
    vi.mocked(waitForLoggedInState).mockRejectedValueOnce(gateError);

    const op = vi.fn().mockRejectedValueOnce(new Error("Action.IncorrectContentStateError"));

    await expect(withLoggedInStateRetry(instance, op)).rejects.toBe(gateError);
    expect(op).toHaveBeenCalledTimes(1);
  });
});

describe("withLoggedInStateRetryAtPort", () => {
  let connectMock: ReturnType<typeof vi.fn>;
  let disconnectMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    connectMock = vi.fn().mockResolvedValue(undefined);
    disconnectMock = vi.fn();
    vi.mocked(InstanceService).mockImplementation(function () {
      return { connect: connectMock, disconnect: disconnectMock } as unknown as InstanceService;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns op result on first success — no InstanceService construction", async () => {
    const op = vi.fn().mockResolvedValue("ok");

    const result = await withLoggedInStateRetryAtPort(9222, "127.0.0.1", false, op);

    expect(result).toBe("ok");
    expect(op).toHaveBeenCalledTimes(1);
    expect(InstanceService).not.toHaveBeenCalled();
    expect(waitForLoggedInState).not.toHaveBeenCalled();
  });

  it("rethrows non-IncorrectContentStateError without constructing InstanceService", async () => {
    const op = vi.fn().mockRejectedValue(new Error("unrelated CDP failure"));

    await expect(withLoggedInStateRetryAtPort(9222, "127.0.0.1", false, op)).rejects.toThrow(
      "unrelated CDP failure",
    );
    expect(InstanceService).not.toHaveBeenCalled();
    expect(waitForLoggedInState).not.toHaveBeenCalled();
  });

  it("constructs InstanceService and waits on retry for IncorrectContentStateError", async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(new Error("Action.IncorrectContentStateError"))
      .mockResolvedValueOnce("ok");

    const result = await withLoggedInStateRetryAtPort(9222, "127.0.0.1", false, op);

    expect(result).toBe("ok");
    expect(op).toHaveBeenCalledTimes(2);
    expect(InstanceService).toHaveBeenCalledTimes(1);
    expect(InstanceService).toHaveBeenCalledWith(9222, { host: "127.0.0.1", allowRemote: false });
    expect(waitForLoggedInState).toHaveBeenCalledTimes(1);
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });

  it("disconnects the InstanceService even if waitForLoggedInState throws", async () => {
    const gateError = new Error("gate timed out");
    vi.mocked(waitForLoggedInState).mockRejectedValueOnce(gateError);
    const op = vi.fn().mockRejectedValueOnce(new Error("Action.IncorrectContentStateError"));

    await expect(withLoggedInStateRetryAtPort(9222, "127.0.0.1", false, op)).rejects.toBe(gateError);
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });

  it("throws LoggedInStatePersistedError when retries exhausted", async () => {
    const op = vi.fn().mockRejectedValue(new Error("Action.IncorrectContentStateError"));

    await expect(
      withLoggedInStateRetryAtPort(9222, "127.0.0.1", false, op, { maxRetries: 1 }),
    ).rejects.toBeInstanceOf(LoggedInStatePersistedError);

    expect(op).toHaveBeenCalledTimes(2);
  });
});
