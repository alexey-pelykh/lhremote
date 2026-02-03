import { pidToPorts, portToPid } from "pid-port";
import psList from "ps-list";

/**
 * Default CDP port used by the LinkedHelper launcher process.
 */
const DEFAULT_LAUNCHER_PORT = 9222;

/**
 * Discover the dynamic CDP port of a running LinkedHelper instance process.
 *
 * LinkedHelper spawns a separate Electron process for each LinkedIn account.
 * That process listens for CDP connections on a dynamic port that changes
 * every session.  This function discovers the port cross-platform using
 * `pid-port` and `ps-list`.
 *
 * The heuristic is:
 * 1. Find the launcher PID by looking for a process listening on `launcherPort`.
 * 2. Find child processes of the launcher.
 * 3. Among those children, find one listening on a TCP port that is NOT the
 *    launcher port — that is the instance's CDP port.
 *
 * @param launcherPort - The known launcher CDP port (default 9222).
 * @returns The dynamic instance CDP port, or `null` if no running instance was found.
 */
export async function discoverInstancePort(
  launcherPort: number = DEFAULT_LAUNCHER_PORT,
): Promise<number | null> {
  const launcherPid = await findPidListeningOn(launcherPort);
  if (launcherPid === null) {
    return null;
  }

  const childPids = await findChildPids(launcherPid);
  if (childPids.length === 0) {
    return null;
  }

  for (const pid of childPids) {
    const port = await findListeningPort(pid, launcherPort);
    if (port !== null) {
      return port;
    }
  }

  return null;
}

/**
 * Find the PID of a process listening on the given TCP port.
 */
async function findPidListeningOn(port: number): Promise<number | null> {
  try {
    const pid = await portToPid({ port, host: "*" });
    return pid ?? null;
  } catch {
    return null;
  }
}

/**
 * Find PIDs of child processes for the given parent PID.
 */
async function findChildPids(parentPid: number): Promise<number[]> {
  try {
    const processes = await psList();
    return processes
      .filter((p) => p.ppid === parentPid)
      .map((p) => p.pid);
  } catch {
    return [];
  }
}

/**
 * Find a TCP listening port for the given PID, excluding `excludePort`.
 */
async function findListeningPort(
  pid: number,
  excludePort: number,
): Promise<number | null> {
  try {
    const ports = await pidToPorts(pid);
    for (const port of ports) {
      if (port !== excludePort) {
        return port;
      }
    }
    return null;
  } catch {
    return null;
  }
}
