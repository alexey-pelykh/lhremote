import { describe } from "vitest";
import { AppService, type AppServiceOptions } from "../services/app.js";
import { AppNotFoundError } from "../services/errors.js";
import { discoverTargets } from "../cdp/discovery.js";

const linkedHelperAvailable = (() => {
  try {
    AppService.findBinary();
    return true;
  } catch (error) {
    if (error instanceof AppNotFoundError) {
      return false;
    }
    throw error;
  }
})();

/**
 * Wrapper around `describe.skipIf` that skips the suite when
 * the LinkedHelper binary is not installed.
 */
export function describeE2E(
  name: string,
  fn: () => void,
): ReturnType<typeof describe> {
  return describe.skipIf(!linkedHelperAvailable)(`${name} (e2e)`, fn);
}

export interface LaunchedApp {
  app: AppService;
  port: number;
}

/**
 * Launch LinkedHelper and wait for the CDP endpoint to become available.
 *
 * @param options.timeout Maximum ms to wait for CDP readiness (default 30 000).
 */
export async function launchApp(options?: {
  timeout?: number;
  appOptions?: AppServiceOptions;
}): Promise<LaunchedApp> {
  const timeout = options?.timeout ?? 30_000;
  const app = new AppService(undefined, options?.appOptions);

  await app.launch();

  const port = app.cdpPort;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    try {
      await discoverTargets(port);
      return { app, port };
    } catch {
      // Not ready yet
    }
    await new Promise<void>((r) => setTimeout(r, 250));
  }

  // Clean up on timeout
  try {
    await app.quit();
  } catch {
    // ignore
  }

  throw new Error(
    `LinkedHelper CDP endpoint did not become available on port ${String(port)} within ${String(timeout)}ms`,
  );
}

/**
 * Quit LinkedHelper, swallowing errors for cleanup use.
 */
export async function quitApp(app: AppService): Promise<void> {
  try {
    await app.quit();
  } catch {
    // Swallow errors during cleanup
  }
}
