/**
 * Check whether a port exposes a CDP `/json/list` endpoint.
 */
export async function isCdpPort(port: number): Promise<boolean> {
  try {
    const response = await fetch(
      `http://127.0.0.1:${String(port)}/json/list`,
    );
    return response.ok;
  } catch {
    return false;
  }
}
