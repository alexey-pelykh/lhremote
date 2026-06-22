// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { pidToPorts } from "pid-port";

import { isCdpPort } from "../utils/cdp-port.js";
import { gatherRawProcesses } from "./gather-raw-processes.js";

/**
 * Known LinkedHelper binary names (case-insensitive) for filtering processes.
 */
const BINARY_NAMES_LOWERCASE = new Set([
  "linked-helper",
  "linked-helper.exe",
  "linkedhelper",
  "linkedhelper.exe",
]);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** How account identity was resolved. */
export type IdentitySource = "cmdline" | "cdp" | "launcher";

/** Confidence level of the resolved identity. */
export type IdentityConfidence = "high" | "low" | "unknown";

/** Account identity parsed from a process command line. */
export interface InstanceIdentity {
  accountId: number | null;
  name?: string;
  email?: string;
  source: IdentitySource;
  confidence: IdentityConfidence;
}

/**
 * A running LinkedHelper account-instance main process, as discovered by
 * inspecting the OS process tree without requiring a live launcher CDP connection.
 *
 * This is the authoritative "which accounts are started" source.
 * Never contains --type= helper children.
 */
export interface RunningInstance {
  accountId: number | null;
  name?: string;
  email?: string;
  pid: number;
  cdpPort: number | null;
  connectable: boolean;
  /** Number of --type= helper child processes (gpu/renderer/utility/crashpad). */
  helperChildCount: number;
  source: IdentitySource;
  confidence: IdentityConfidence;
}

/** A process suspected of being an orphaned account-instance main process. */
export interface OrphanProcess {
  pid: number;
  cdpPort: number | null;
  accountId: number | null;
  reason: string;
}

// ---------------------------------------------------------------------------
// Internal raw process representation
// ---------------------------------------------------------------------------

type DetailedRole = "launcher" | "instance" | "helper-child" | "unknown";

// ---------------------------------------------------------------------------
// Role classification
// ---------------------------------------------------------------------------

/**
 * Classify a LinkedHelper process using command-line analysis first, with
 * parent-PID as fallback.
 *
 * Rules (applied in order):
 * 1. `--type=<something>` present → helper child (gpu/renderer/utility/crashpad).
 * 2. Path contains `resources[\/]out[\/]` → instance main (identity confidence
 *    depends on whether `--app-id` / `--user-li-id` are also present).
 * 3. Path does NOT contain `resources[\/]out[\/]` → launcher.
 * 4. Fallback: parent PID in LH PID set → instance; otherwise launcher.
 */
function classifyDetailedRole(
  cmdline: string | null,
  ppid: number,
  lhPids: Set<number>,
): DetailedRole {
  if (cmdline) {
    if (/--type=/.test(cmdline)) {
      return "helper-child";
    }
    // Any process running from resources/out/ is an instance main process.
    // Identity confidence (high vs unknown) depends on whether --app-id is
    // present; role classification does not require it.
    if (/resources[/\\]out[/\\]/i.test(cmdline)) {
      return "instance";
    }
    return "launcher";
  }
  // Fallback: parent-PID heuristic
  return lhPids.has(ppid) ? "instance" : "launcher";
}

// ---------------------------------------------------------------------------
// Security-constrained identity parser
// ---------------------------------------------------------------------------

/**
 * Find the start position of a flag in a command line, verifying it is
 * preceded by start-of-string or whitespace (to avoid matching substrings
 * of longer flags).
 */
function findFlagStart(cmdline: string, flag: string): number {
  let idx = 0;
  while (true) {
    const pos = cmdline.indexOf(flag, idx);
    if (pos === -1) return -1;
    // Accept whitespace or `"` before the flag: Windows WMI CommandLine wraps
    // args containing special characters in outer double-quotes, so the flag
    // is preceded by `"` rather than a space (e.g. `"--user-li={...}"`).
    if (pos === 0 || /[\s"]/.test(cmdline[pos - 1] ?? "")) return pos;
    idx = pos + 1;
  }
}

/**
 * Extract a balanced JSON object starting at `startIdx` in `str`.
 * Returns `null` if the braces are unbalanced or `str[startIdx]` is not `{`.
 */
function extractBalancedJson(str: string, startIdx: number): string | null {
  if (str[startIdx] !== "{") return null;

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = startIdx; i < str.length; i++) {
    const ch = str[i] ?? "";
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    // Treat backslash as an escape regardless of string state. Windows/Electron
    // command lines store --user-li JSON with backslash-escaped quotes (\"), so
    // the quote delimiters themselves are escaped; an always-on escape rule is
    // required to keep brace matching balanced for that format.
    if (ch === "\\") {
      escapeNext = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return str.substring(startIdx, i + 1);
      }
    }
  }
  return null;
}

/**
 * Parse account identity from a process command line.
 *
 * Exported for reuse in other modules that inspect process command lines.
 *
 * SECURITY ALLOWLIST — only these fields are ever extracted:
 *   `--app-id`, `--user-li-id`, and `id`/`fullName`/`email` from `--user-li`.
 *
 * Fields NEVER captured:
 *   `--app-credentials`, `--upstream-proxy`, `--sentry`, `--lh-account`,
 *   license tokens, or any other non-allowlisted argument.
 *
 * `--lh-account` is intentionally IGNORED: it carries the license-owner
 * identity (identical across all instances) and must never be used to
 * identify the per-account LinkedIn user.
 */
export function parseIdentityFromCmdline(cmdline: string): InstanceIdentity {
  let accountId: number | null = null;
  let name: string | undefined;
  let email: string | undefined;

  // Primary: --app-id (most reliable, always a plain integer)
  const appIdMatch = /--app-id=(\d+)/.exec(cmdline);
  if (appIdMatch) {
    accountId = parseInt(appIdMatch[1] ?? "", 10);
  }

  // Fallback: --user-li-id
  if (accountId === null) {
    const liIdMatch = /--user-li-id=(\d+)/.exec(cmdline);
    if (liIdMatch) {
      accountId = parseInt(liIdMatch[1] ?? "", 10);
    }
  }

  // Extract identity details from --user-li=<JSON>
  // Note: --user-li= is distinct from --user-li-id= (different suffix)
  const userLiFlagPos = findFlagStart(cmdline, "--user-li=");
  if (userLiFlagPos !== -1) {
    const valueStart = userLiFlagPos + "--user-li=".length;
    const jsonStart = cmdline.indexOf("{", valueStart);
    if (jsonStart !== -1 && jsonStart === valueStart) {
      const jsonStr = extractBalancedJson(cmdline, jsonStart);
      if (jsonStr) {
        try {
          // Windows/Electron store --user-li JSON with backslash-escaped
          // quotes (e.g. {\"id\":...}); unescape \" and \\ before parsing.
          const unescaped = jsonStr.replace(/\\(["\\])/g, "$1");
          const parsed: unknown = JSON.parse(unescaped);
          if (parsed !== null && typeof parsed === "object") {
            const obj = parsed as Record<string, unknown>;
            // Allowlist: id, fullName, email only (avatar not exposed in output)
            if (accountId === null && typeof obj["id"] === "number") {
              accountId = obj["id"] as number;
            }
            if (typeof obj["fullName"] === "string") {
              name = obj["fullName"] as string;
            }
            if (typeof obj["email"] === "string") {
              email = obj["email"] as string;
            }
          }
        } catch {
          // Malformed JSON — skip
        }
      }
    }
  }

  if (accountId !== null) {
    const identity: InstanceIdentity = { accountId, source: "cmdline", confidence: "high" };
    if (name !== undefined) identity.name = name;
    if (email !== undefined) identity.email = email;
    return identity;
  }
  return { accountId: null, source: "cmdline", confidence: "unknown" };
}

// ---------------------------------------------------------------------------
// CDP probing
// ---------------------------------------------------------------------------

async function probeCdp(
  pid: number,
): Promise<{ cdpPort: number | null; connectable: boolean }> {
  let ports: Set<number>;
  try {
    ports = await pidToPorts(pid);
  } catch {
    return { cdpPort: null, connectable: false };
  }

  for (const port of ports) {
    if (await isCdpPort(port)) {
      return { cdpPort: port, connectable: true };
    }
  }

  return { cdpPort: [...ports][0] ?? null, connectable: false };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan the OS process tree and return all running LinkedHelper account-instance
 * main processes with their resolved identities.
 *
 * This function is LAUNCHER-INDEPENDENT: it works even when the launcher CDP
 * is unreachable.  Identity is resolved from process command-line arguments
 * using an allowlist parser that never captures credentials or secrets.
 *
 * Helper child processes (`--type=` flag) are NEVER included in the result;
 * their count is reflected in `helperChildCount` on the owning instance.
 *
 * Results are sorted connectable-first.
 */
export async function scanRunningInstances(): Promise<RunningInstance[]> {
  const allProcs = await gatherRawProcesses();
  const lhProcs = allProcs.filter((p) =>
    BINARY_NAMES_LOWERCASE.has(p.name.toLowerCase()),
  );

  if (lhProcs.length === 0) return [];

  const lhPids = new Set(lhProcs.map((p) => p.pid));

  // Classify every LH process
  const classified = lhProcs.map((p) => ({
    ...p,
    role: classifyDetailedRole(p.cmdline, p.ppid, lhPids),
  }));

  // Count helper children per parent PID
  const helperCounts = new Map<number, number>();
  for (const p of classified) {
    if (p.role === "helper-child") {
      helperCounts.set(p.ppid, (helperCounts.get(p.ppid) ?? 0) + 1);
    }
  }

  // Build RunningInstance for each account-instance main process
  const instanceProcs = classified.filter((p) => p.role === "instance");

  const results = await Promise.all(
    instanceProcs.map(async (p) => {
      const identity = parseIdentityFromCmdline(p.cmdline ?? "");
      const { cdpPort, connectable } = await probeCdp(p.pid);
      const instance: RunningInstance = {
        pid: p.pid,
        cdpPort,
        connectable,
        helperChildCount: helperCounts.get(p.pid) ?? 0,
        source: identity.source,
        confidence: identity.confidence,
        accountId: identity.accountId,
      };
      if (identity.name !== undefined) instance.name = identity.name;
      if (identity.email !== undefined) instance.email = identity.email;
      return instance;
    }),
  );

  // Sort: connectable first
  return results.sort((a, b) => {
    if (a.connectable === b.connectable) return 0;
    return a.connectable ? -1 : 1;
  });
}

/**
 * Detect orphaned account-instance main processes.
 *
 * A TRUE orphan is narrowly defined:
 * - Is an account-instance main process (under `resources[\/]out[\/]` or has `--app-id`)
 * - Is non-connectable (no live CDP port)
 * - Is NOT a helper child (`--type=` flag absent)
 * - Is NOT the live instance for any account in `liveInstances`
 *
 * Chromium helper children (`--type=`) are NEVER orphans regardless of
 * their parent's state.
 *
 * @param liveInstances - The result of {@link scanRunningInstances} (connectable instances).
 */
export async function scanOrphans(
  liveInstances: RunningInstance[],
): Promise<OrphanProcess[]> {
  const allProcs = await gatherRawProcesses();
  const lhProcs = allProcs.filter((p) =>
    BINARY_NAMES_LOWERCASE.has(p.name.toLowerCase()),
  );

  if (lhProcs.length === 0) return [];

  const lhPids = new Set(lhProcs.map((p) => p.pid));
  const livePids = new Set(liveInstances.map((i) => i.pid));
  const liveAccountIds = new Set<number>(
    liveInstances
      .filter((i): i is typeof i & { accountId: number } => i.connectable && i.accountId !== null)
      .map((i) => i.accountId),
  );

  const orphans: OrphanProcess[] = [];

  for (const proc of lhProcs) {
    const role = classifyDetailedRole(proc.cmdline, proc.ppid, lhPids);

    // Helper children are never orphans
    if (role === "helper-child" || role === "launcher") continue;
    // Already live — not an orphan
    if (livePids.has(proc.pid)) continue;

    // It's a non-live instance-side process — check if it's non-connectable
    const { cdpPort, connectable } = await probeCdp(proc.pid);
    if (connectable) continue; // Still connectable — not an orphan

    const identity = parseIdentityFromCmdline(proc.cmdline ?? "");

    // If the account is live under a different PID, this is a stale duplicate
    const reason =
      identity.accountId !== null && liveAccountIds.has(identity.accountId)
        ? `non-connectable duplicate for account ${String(identity.accountId)} (live instance exists)`
        : "non-connectable account-instance process with no live counterpart";

    orphans.push({
      pid: proc.pid,
      cdpPort,
      accountId: identity.accountId,
      reason,
    });
  }

  return orphans;
}

/**
 * Terminate orphaned processes.
 *
 * SAFETY RULES (enforced unconditionally):
 * - Only kills processes returned by {@link scanOrphans} — never connectable,
 *   never launcher, never helper-child-of-live-parent, never account-mapped.
 * - Dry-run by default: pass `confirm: true` to perform actual termination.
 *
 * @returns Per-PID result table (action taken or reason skipped).
 */
export async function reapOrphans(
  orphans: OrphanProcess[],
  confirm: boolean,
): Promise<Array<{ pid: number; action: "killed" | "skipped" | "dry-run"; reason?: string }>> {
  return Promise.all(
    orphans.map(async (o) => {
      if (!confirm) {
        return { pid: o.pid, action: "dry-run" as const };
      }
      try {
        process.kill(o.pid, "SIGKILL");
        return { pid: o.pid, action: "killed" as const };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { pid: o.pid, action: "skipped" as const, reason: msg };
      }
    }),
  );
}
