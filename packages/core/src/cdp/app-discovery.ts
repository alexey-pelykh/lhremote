import { pidToPorts } from "pid-port";
import psList from "ps-list";
import { isCdpPort } from "../utils/cdp-port.js";

/**
 * Known LinkedHelper binary names across platforms.
 */
const BINARY_NAMES = ["linked-helper", "linked-helper.exe"];

/**
 * Result of discovering a running LinkedHelper application process.
 */
export interface DiscoveredApp {
  /** OS process ID. */
  pid: number;

  /** CDP port the process is listening on, or `null` if none detected. */
  cdpPort: number | null;

  /** Whether the CDP endpoint responded to a probe. */
  connectable: boolean;
}

/**
 * Scan the system for running LinkedHelper application processes.
 *
 * For each matching process, attempts to detect a CDP debugging port
 * by inspecting its listening TCP ports and probing them with an HTTP
 * request to the CDP `/json/list` endpoint.
 *
 * @returns An array of discovered LinkedHelper processes (may be empty).
 */
export async function findApp(): Promise<DiscoveredApp[]> {
  const processes = await listLinkedHelperProcesses();
  if (processes.length === 0) {
    return [];
  }

  return Promise.all(processes.map(probeProcess));
}

/**
 * List PIDs of processes whose name matches a known LinkedHelper binary.
 */
async function listLinkedHelperProcesses(): Promise<number[]> {
  try {
    const all = await psList();
    return all
      .filter((p) => BINARY_NAMES.includes(p.name))
      .map((p) => p.pid);
  } catch {
    return [];
  }
}

/**
 * Probe a single process for CDP connectivity.
 */
async function probeProcess(pid: number): Promise<DiscoveredApp> {
  let ports: Set<number>;
  try {
    ports = await pidToPorts(pid);
  } catch {
    return { pid, cdpPort: null, connectable: false };
  }

  for (const port of ports) {
    if (await isCdpPort(port)) {
      return { pid, cdpPort: port, connectable: true };
    }
  }

  // Process is running but no CDP port detected (or none responding)
  const firstPort = [...ports][0] ?? null;
  return { pid, cdpPort: firstPort, connectable: false };
}
