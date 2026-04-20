// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CDPClient } from "../cdp/client.js";
import { CDPTimeoutError } from "../cdp/errors.js";
import { waitForElement } from "../linkedin/dom-automation.js";
import type { HumanizedMouse } from "../linkedin/humanized-mouse.js";
import { gaussianDelay, maybeHesitate } from "../utils/delay.js";
import { navigateAwayIf } from "./navigate-away.js";

/**
 * Regex matching a LinkedIn profile URL *pathname* (not the full URL) and
 * capturing the public ID from the first `/in/{slug}` segment.
 */
export const LINKEDIN_PROFILE_RE = /^\/in\/([^/?#]+)/;

/**
 * Selector that identifies a loaded profile page.
 *
 * Matches any action button in the profile card action row — Message,
 * Follow/Following, Connect/Pending, More actions.  LinkedIn no longer
 * wraps the profile name in an `<h1>` element; action-button `aria-label`
 * attributes remain stable across DOM redesigns and are the signal both
 * downstream operations (unfollow-profile, hide-feed-author-profile)
 * already key off.  Any one present indicates the profile card has
 * hydrated enough for follow-state or More-menu detection.
 */
export const PROFILE_READY_SELECTOR = [
  'main button[aria-label^="Message"]',
  'main button[aria-label^="Follow "]',
  'main button[aria-label^="Following "]',
  'main button[aria-label^="Connect"]',
  'main button[aria-label^="Pending"]',
  'main button[aria-label="More actions"]',
  'main button[aria-label="More"]',
].join(", ");

/**
 * Extract the public ID (URL slug) from a LinkedIn profile URL.
 *
 * The URL is parsed with {@link URL} and validated: the hostname must end
 * with `linkedin.com` and the pathname must start with `/in/{publicId}`.
 * The captured slug is URL-decoded before being returned.  Relative URLs,
 * query-embedded profile links (e.g. `?next=https://.../in/foo`), and
 * non-LinkedIn hosts are all rejected with a descriptive error.
 *
 * @throws If `url` is not a well-formed LinkedIn profile URL.
 */
export function extractPublicId(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      `Invalid LinkedIn profile URL: ${url}. Expected format: https://www.linkedin.com/in/<public-id>`,
    );
  }

  const host = parsed.hostname.toLowerCase();
  const isLinkedInHost = host === "linkedin.com" || host.endsWith(".linkedin.com");
  if (!isLinkedInHost) {
    throw new Error(
      `Invalid LinkedIn profile URL: ${url}. Expected format: https://www.linkedin.com/in/<public-id>`,
    );
  }

  const match = LINKEDIN_PROFILE_RE.exec(parsed.pathname);
  if (!match?.[1]) {
    throw new Error(
      `Invalid LinkedIn profile URL: ${url}. Expected format: https://www.linkedin.com/in/<public-id>`,
    );
  }
  return decodeURIComponent(match[1]);
}

/**
 * Build a canonical LinkedIn profile URL from a public ID.
 *
 * The public ID is URL-encoded before interpolation so values containing
 * characters like `%` (non-ASCII slugs) produce valid URLs.
 */
export function buildProfileUrl(publicId: string): string {
  return `https://www.linkedin.com/in/${encodeURIComponent(publicId)}/`;
}

/**
 * Navigate the CDP-controlled LinkedIn tab to the profile identified by
 * `publicId`, forcing a full reload if the tab is already on a profile page.
 *
 * After navigation, waits for the profile action-button row (Message,
 * Follow/Following, Connect/Pending, or More actions) to appear — any of
 * these indicates the profile card has hydrated enough for downstream
 * detection.  A short humanized dwell follows to let remaining action
 * buttons fully render.
 *
 * On timeout, if `LHREMOTE_CAPTURE_DIAGNOSTICS=1`, a best-effort
 * diagnostic capture is written to `${os.tmpdir()}/lhremote-diagnostics/`
 * before the error propagates; see {@link captureProfileLoadFailure}.
 *
 * @param client   - Connected CDP client targeting a LinkedIn page.
 * @param publicId - LinkedIn public ID (URL slug), e.g. `"jane-doe-123"`.
 * @param mouse    - Optional humanized mouse for idle drift during waits.
 */
export async function navigateToProfile(
  client: CDPClient,
  publicId: string,
  mouse?: HumanizedMouse | null | undefined,
): Promise<void> {
  await navigateAwayIf(client, "/in/");
  await client.navigate(buildProfileUrl(publicId));
  try {
    await waitForElement(client, PROFILE_READY_SELECTOR, { timeout: 30_000 }, mouse);
  } catch (error) {
    if (error instanceof CDPTimeoutError) {
      // captureProfileLoadFailure self-gates on LHREMOTE_CAPTURE_DIAGNOSTICS.
      await captureProfileLoadFailure(client, publicId);
    }
    throw error;
  }
  // Let the SPA finish hydrating action buttons (Follow, More, Message).
  await gaussianDelay(800, 200, 500, 1_500);
  await maybeHesitate();
}

/**
 * Sanitize a value for use as a filename fragment: keep only a conservative
 * filesystem-safe character set and cap length.  Public IDs come from
 * `extractPublicId` which URL-decodes the slug, so encoded path separators
 * (`%2F`, `%5C`) or parent-directory markers (`..`) could otherwise slip
 * into the filename and allow directory traversal out of the diagnostics
 * base directory.
 */
function sanitizeForFilename(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return safe.length > 0 ? safe : "unknown";
}

/**
 * Cap on the wall-clock time the diagnostic capture is awaited before the
 * caller's timeout is re-thrown.  Without this, a misbehaving CDP
 * connection could prolong error propagation by up to `CDPClient.send`'s
 * own timeout per call (`Runtime.evaluate` + `Page.captureScreenshot`).
 */
const DIAGNOSTIC_CAPTURE_TIMEOUT_MS = 10_000;

/**
 * Mutable cancellation state shared between the outer wrapper and the
 * inner capture body.  The wrapper flips `timedOut` when the bound timer
 * wins the race; the inner body checks between each async step and
 * returns early, giving up any remaining writes so the process can exit
 * promptly.
 */
interface CaptureCancellationState {
  timedOut: boolean;
}

/**
 * Best-effort diagnostic capture when `navigateToProfile` times out waiting
 * for the profile action-button row.  Writes
 * `navigate-to-profile-{timestamp}-{publicId}.json` (URL, title, DOM
 * probes, visible text snippet) and `.png` (full-page
 * `Page.captureScreenshot` with `captureBeyondViewport: true`) under
 * `${os.tmpdir()}/lhremote-diagnostics/` so callers can classify the
 * failure — auth wall, DOM change, or silent navigation error.
 *
 * **Opt-in only.** Self-gated on `LHREMOTE_CAPTURE_DIAGNOSTICS=1` — no-op
 * otherwise.  Default-off in production (CLI, MCP server) because the
 * artifacts can contain personal data from the LinkedIn profile page.
 * E2E tests activate it via `vitest.e2e.config.ts` `env` so every run
 * produces diagnostics without touching the codebase.
 *
 * `publicId` is sanitized before interpolation into the filename to
 * prevent path traversal via URL-decoded slugs.
 *
 * The diagnostics directory is created with mode `0o700` and files with
 * mode `0o600` (POSIX; no-op on Windows) so that personal data in a
 * shared `os.tmpdir()` is not exposed to other local users.
 *
 * The capture is cooperatively cancellable and bounded by
 * {@link DIAGNOSTIC_CAPTURE_TIMEOUT_MS}: the outer wrapper stops awaiting
 * at the cap, and the inner body checks a shared cancellation flag
 * between each step and returns early when it flips — so remaining CDP
 * calls and disk writes are skipped rather than merely un-awaited.  In
 * rare cases the in-flight async step started before the cap may still
 * complete in the background; the process is not held alive by this
 * function beyond the cap plus any such single in-flight step.
 *
 * Any capture-side failure is swallowed so the original timeout always
 * propagates unchanged.
 *
 * @internal Exported for unit testing only; not part of the public API.
 */
export async function captureProfileLoadFailure(
  client: CDPClient,
  publicId: string,
): Promise<void> {
  if (process.env.LHREMOTE_CAPTURE_DIAGNOSTICS !== "1") return;
  const state: CaptureCancellationState = { timedOut: false };
  let bound: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      captureProfileLoadFailureInner(client, publicId, state),
      new Promise<void>((resolve) => {
        bound = setTimeout(() => {
          state.timedOut = true;
          resolve();
        }, DIAGNOSTIC_CAPTURE_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // Capture itself failed; do not mask the caller's timeout.
  } finally {
    if (bound !== undefined) clearTimeout(bound);
  }
}

async function captureProfileLoadFailureInner(
  client: CDPClient,
  publicId: string,
  state: CaptureCancellationState,
): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const baseDir = join(tmpdir(), "lhremote-diagnostics");
  // 0o700: owner-only rwx.  POSIX-only; no-op on Windows.
  await mkdir(baseDir, { recursive: true, mode: 0o700 });
  if (state.timedOut) return;
  const prefix = join(
    baseDir,
    `navigate-to-profile-${timestamp}-${sanitizeForFilename(publicId)}`,
  );

  const info = await client.evaluate<{
    href: string;
    title: string;
    hasMain: boolean;
    hasH1: boolean;
    hasMainH1: boolean;
    bodyTextSnippet: string;
  }>(`(() => ({
    href: location.href,
    title: document.title,
    hasMain: document.querySelector("main") !== null,
    hasH1: document.querySelector("h1") !== null,
    hasMainH1: document.querySelector("main h1") !== null,
    bodyTextSnippet: (document.body ? document.body.innerText : "").slice(0, 800),
  }))()`);
  if (state.timedOut) return;

  // 0o600: owner-only rw.  POSIX-only; no-op on Windows.
  await writeFile(`${prefix}.json`, JSON.stringify(info, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  if (state.timedOut) return;

  try {
    const screenshot = (await client.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
    })) as { data?: string };
    if (state.timedOut) return;
    if (screenshot.data) {
      await writeFile(`${prefix}.png`, Buffer.from(screenshot.data, "base64"), {
        mode: 0o600,
      });
    }
  } catch {
    // Screenshot is best-effort; info.json is the primary artifact.
  }
  if (state.timedOut) return;

  console.warn(
    `[navigateToProfile] timeout diagnostics written: ${prefix}.{json,png}`,
  );
}
