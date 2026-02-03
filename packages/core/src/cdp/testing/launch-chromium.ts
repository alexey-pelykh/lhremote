import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { discoverTargets } from "../discovery.js";

/** Result of launching a test Chromium instance. */
export interface ChromiumInstance {
  /** CDP debugging port. */
  port: number;
  /** The spawned Chromium process. */
  process: ChildProcess;
  /** Gracefully shut down the Chromium instance. */
  close: () => Promise<void>;
}

/**
 * Find a free TCP port by briefly binding to port 0.
 */
async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr === null || typeof addr === "string") {
        server.close();
        reject(new Error("Failed to get port from server address"));
        return;
      }
      const { port } = addr;
      server.close(() => {
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}

/**
 * Launch a headless Chromium instance with CDP enabled on a random free port.
 *
 * Uses the Chromium binary installed by `playwright-core`.  The instance
 * is configured for test isolation (temp profile, no sandbox).
 *
 * @param options.timeout - Maximum time (ms) to wait for CDP to become
 *   available (default 10 000).
 * @returns A {@link ChromiumInstance} handle.
 */
export async function launchChromium(options?: {
  timeout?: number;
}): Promise<ChromiumInstance> {
  const timeout = options?.timeout ?? 10_000;
  const port = await findFreePort();
  const userDataDir = join(
    tmpdir(),
    `lhremote-cdp-test-${port.toString()}-${Date.now().toString(36)}`,
  );

  const executablePath = chromium.executablePath();
  const child = spawn(
    executablePath,
    [
      `--remote-debugging-port=${port.toString()}`,
      `--user-data-dir=${userDataDir}`,
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-extensions",
      "--use-mock-keychain",
    ],
    { stdio: "ignore" },
  );

  // Wait for CDP endpoint to become available
  const deadline = Date.now() + timeout;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const targets = await discoverTargets(port);
      if (targets.length > 0) {
        ready = true;
        break;
      }
    } catch {
      // Not ready yet
    }
    await new Promise<void>((r) => setTimeout(r, 100));
  }

  if (!ready) {
    child.kill("SIGKILL");
    throw new Error(
      `Chromium CDP endpoint did not become available on port ${port.toString()} within ${timeout.toString()}ms`,
    );
  }

  const close = async (): Promise<void> => {
    if (child.exitCode !== null) {
      return;
    }
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 5_000);
      child.on("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  };

  return { port, process: child, close };
}
