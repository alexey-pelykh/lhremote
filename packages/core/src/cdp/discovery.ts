import type { CdpTarget } from "../types/cdp.js";
import { CDPConnectionError } from "./errors.js";

/**
 * Default host used for CDP target discovery.
 */
const DEFAULT_HOST = "127.0.0.1";

/**
 * Discover Chrome DevTools Protocol targets exposed at the given port.
 *
 * Fetches the `/json/list` HTTP endpoint that Chromium-based browsers
 * expose for debugging target enumeration.
 *
 * @param port  - CDP debugging port (e.g. 9222 for the launcher process).
 * @param host  - Host to connect to (default `127.0.0.1`).
 * @returns Array of discovered CDP targets.
 * @throws {CDPConnectionError} When the endpoint is unreachable.
 */
export async function discoverTargets(
  port: number,
  host: string = DEFAULT_HOST,
): Promise<CdpTarget[]> {
  const url = `http://${host}:${port}/json/list`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new CDPConnectionError(
      `Failed to discover CDP targets at ${url}: LinkedHelper not running or CDP not enabled`,
      { cause: error },
    );
  }

  if (!response.ok) {
    throw new CDPConnectionError(
      `CDP target discovery returned HTTP ${response.status.toString()} at ${url}`,
    );
  }

  return (await response.json()) as CdpTarget[];
}
