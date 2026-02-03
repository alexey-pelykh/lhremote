import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { AppService } from "@lhremote/core";
import {
  describeE2E,
  launchApp,
  quitApp,
} from "../../../core/src/testing/e2e-helpers.js";
import { handleListAccounts } from "./list-accounts.js";
import { handleQuitApp } from "./quit-app.js";

describeE2E("CLI handlers", () => {
  let app: AppService;
  let port: number;

  const originalExitCode = process.exitCode;

  beforeAll(async () => {
    const launched = await launchApp();
    app = launched.app;
    port = launched.port;
  }, 60_000);

  afterAll(async () => {
    await quitApp(app);
  }, 15_000);

  beforeEach(() => {
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("handleListAccounts --json writes valid JSON to stdout", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    await handleListAccounts({ cdpPort: port, json: true });

    expect(process.exitCode).toBeUndefined();
    expect(stdoutSpy).toHaveBeenCalled();

    const output = stdoutSpy.mock.calls
      .map((call) => String(call[0]))
      .join("");
    const parsed = JSON.parse(output) as unknown;
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("handleListAccounts prints formatted output", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    await handleListAccounts({ cdpPort: port });

    expect(process.exitCode).toBeUndefined();
    expect(stdoutSpy).toHaveBeenCalled();
  });

  it("handleQuitApp writes success message to stdout", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);

    await handleQuitApp({ cdpPort: port });

    expect(process.exitCode).toBeUndefined();
    expect(stdoutSpy).toHaveBeenCalledWith("LinkedHelper quit\n");

    // Prevent afterAll from trying to quit the already-quit app
    app = new AppService();
  }, 15_000);
});
