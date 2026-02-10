/**
 * Return a promise that resolves after the given number of milliseconds.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
