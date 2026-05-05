// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { chmod, lstat, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { delay } from "../utils/delay.js";
import type { CDPClient } from "./client.js";

// ----------------------------------------------------------------------------
// Selectors used by both the readiness predicate ({@link waitForPostLoad}) and
// the diagnostic probe ({@link capturePostLoadFailure}).  Centralizing them
// keeps the two aligned: the predicate's joined disjunction is exactly the
// union of the three probes the diagnostic reports individually, so a future
// timeout's "which-of-three-is-missing" signal stays accurate by definition.
// ----------------------------------------------------------------------------

/**
 * `<main>`-scoped author link — anchor pointing to either a member profile
 * (`/in/{slug}`) or a company page (`/company/{slug}`).  Phase 1 (PR #770)
 * confirmed this anchor still renders post-2026-05 markup refresh; the
 * `<main>` scope avoids matching nav / sidebar profile chips that hydrate
 * before the post itself.
 */
const POST_READY_AUTHOR_LINK_SELECTOR =
  'main a[href*="/in/"], main a[href*="/company/"]';

/**
 * Document-wide author-link selector — diagnostic-only.  Reported alongside
 * {@link POST_READY_AUTHOR_LINK_SELECTOR} so a future regression can
 * distinguish "page failed to render entirely" from "page rendered nav /
 * sidebar chips but not the post body".
 */
const POST_AUTHOR_LINK_DOCUMENT_WIDE_SELECTOR =
  'a[href*="/in/"], a[href*="/company/"]';

// Post-detail interaction markers (per ADR-007 — aria-label-based markers
// preferred over structural CSS / role selectors).  Each renders only after
// the post has hydrated far enough for downstream extraction; any single
// match satisfies the readiness predicate.  The diagnostic probe reports
// each individually so a future timeout produces a precise
// "which-of-three-is-missing" signal.
const POST_REACT_LIKE_SELECTOR =
  'main button[aria-label^="React Like to "]';
const POST_COMMENT_ON_SELECTOR =
  'main button[aria-label^="Comment on"]';
const POST_EDITOR_SELECTOR =
  'main [role="textbox"][aria-label^="Text editor for creating"]';

/** Comma-separated disjunction of the three interaction markers. */
const POST_INTERACTION_SELECTOR = [
  POST_REACT_LIKE_SELECTOR,
  POST_COMMENT_ON_SELECTOR,
  POST_EDITOR_SELECTOR,
].join(", ");

/**
 * Legacy `span[dir="ltr"]` fallback selector.  Phase 1 confirmed gone as of
 * 2026-05-05 but kept defensively: costs nothing if missing, and provides a
 * path back to the original signal if/when LinkedIn restores the markup.
 */
const POST_LTR_SPAN_FALLBACK_SELECTOR = 'span[dir="ltr"]';

/**
 * Poll the DOM until a LinkedIn post detail page has rendered.
 *
 * Three-stage layered predicate (per ADR-007):
 *  1. {@link POST_READY_AUTHOR_LINK_SELECTOR} must match — required.
 *  2. Any of {@link POST_INTERACTION_SELECTOR} suffices.
 *  3. Otherwise fall back to {@link POST_LTR_SPAN_FALLBACK_SELECTOR}.
 *
 * Issues #762 / #771: the original `span[dir="ltr"]`-only predicate stopped
 * matching after LinkedIn's 2026-05 post-detail markup refresh removed
 * `[data-testid="mainFeed"]`, `span[dir="ltr"]`, and `<article>`.  Phase 1
 * (PR #770) shipped diagnostic capture that pinned the regression; this
 * helper closes it.
 *
 * On timeout, if `LHREMOTE_CAPTURE_DIAGNOSTICS=1`, a best-effort diagnostic
 * capture is written to a per-invocation
 * `${os.tmpdir()}/lhremote-diagnostics-XXXXXX/` directory before the error
 * propagates; see {@link capturePostLoadFailure}.  Opt-in because LinkedIn
 * post-detail pages can include personal data.
 *
 * @param client    - Connected CDP client targeting a LinkedIn page.
 * @param timeoutMs - Polling deadline in milliseconds (default: 15s).
 *
 * @throws If the readiness selectors do not match before the deadline.
 */
export async function waitForPostLoad(
  client: CDPClient,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await client.evaluate<boolean>(`(() => {
      if (!document.querySelector('${POST_READY_AUTHOR_LINK_SELECTOR}')) return false;
      if (document.querySelector('${POST_INTERACTION_SELECTOR}')) return true;
      return document.querySelectorAll('${POST_LTR_SPAN_FALLBACK_SELECTOR}').length > 0;
    })()`);
    if (ready) return;
    await delay(500);
  }
  // capturePostLoadFailure self-gates on LHREMOTE_CAPTURE_DIAGNOSTICS and
  // swallows its own errors, so the original timeout always propagates
  // unchanged regardless of capture-side outcome.
  await capturePostLoadFailure(client);
  throw new Error(
    "Timed out waiting for post detail to appear in the DOM",
  );
}

/**
 * Cap on the wall-clock time the diagnostic capture is awaited before
 * the caller's timeout is re-thrown.  Without this, a misbehaving CDP
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
 * Best-effort diagnostic capture when {@link waitForPostLoad} times out
 * waiting for the post-detail DOM anchors.  Each invocation creates a
 * fresh `${os.tmpdir()}/lhremote-diagnostics-XXXXXX/` directory via
 * `mkdtemp` (atomic; refuses to follow any pre-existing symlink at the
 * prefix) and writes `wait-for-post-load-{timestamp}.json` (URL, title,
 * DOM probes, visible text snippet) and a sibling `.png` (full-page
 * `Page.captureScreenshot` with `captureBeyondViewport: true`, when the
 * screenshot succeeds) inside it, so callers can classify the failure —
 * auth wall, DOM change, or silent navigation error.  Per-invocation
 * directories prevent concurrent timeouts from `get-post` /
 * `get-post-engagers` / `get-post-stats` from clobbering each other's
 * artifacts AND close the TOCTOU window a shared parent directory
 * would otherwise leave open.  The trailing `console.warn` reports
 * only the artifacts that were actually written; the `.png` is
 * best-effort and may be absent.
 *
 * **Opt-in only.** Self-gated on `LHREMOTE_CAPTURE_DIAGNOSTICS=1` —
 * no-op otherwise.  Default-off in production (CLI, MCP server) because
 * the artifacts can contain personal data from the LinkedIn post-detail
 * page.  E2E tests activate it via `vitest.e2e.config.ts` `env` so every
 * run produces diagnostics without touching the codebase.
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
 * Probe set: `{ href, title, hasMain, hasMainFeed,
 * mainFeedListItemCount, mainFeedListItemsWithMenuButton,
 * mainFeedListItemsViableForPostScrape, hasAuthorLink,
 * hasAuthorLinkInMain, hasLtrSpans, hasArticles, hasReactLikeButton,
 * hasCommentOnButton, hasTopLevelEditor, bodyTextSnippet }` —
 * mirrors the container-selection logic in
 * `SCRAPE_POST_DETAIL_SCRIPT`: it scopes from `<main>` (fallback) →
 * `[data-testid="mainFeed"]` → `div[role="listitem"]` inside that
 * feed → per-item `button[aria-label^="Open control menu for post"]`
 * → items with `offsetHeight >= 100` (the scraper skips smaller
 * skeleton/hidden items).  Each layer is probed separately so a
 * future timeout reproduces the exact selector-presence picture
 * without re-running the wait.  Counts (rather than booleans) for
 * the listitem, menu-button, and viable-item layers help Phase 2
 * distinguish "wrapper renamed" from "no items rendered yet" from
 * "items present but skeleton-sized" — a healthy `mainFeed` with
 * zero listitems is a different failure mode than a missing
 * `mainFeed`, and items with menu buttons but `offsetHeight < 100`
 * would be picked up by a naive count yet rejected by the scraper.
 * The menu-button count is scoped to listitems inside `mainFeed`
 * (not document-wide) so it can't be inflated by unrelated buttons
 * elsewhere on the page.
 *
 * The post-#771 probes (`hasAuthorLinkInMain`, `hasReactLikeButton`,
 * `hasCommentOnButton`, `hasTopLevelEditor`) shadow
 * {@link waitForPostLoad}'s readiness selectors so a timeout pins
 * exactly which post-anchored signal is missing.
 *
 * Mirrors the diagnostic-capture pattern documented in ADR-007 for
 * `navigateToProfile` — same env var, same artifact structure, same
 * cancellation discipline.
 *
 * @internal Exported for unit testing only; not part of the public API.
 */
export async function capturePostLoadFailure(
  client: CDPClient,
): Promise<void> {
  if (process.env.LHREMOTE_CAPTURE_DIAGNOSTICS !== "1") return;
  const state: CaptureCancellationState = { timedOut: false };
  let bound: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      // Attach a no-op catch to the inner promise so a late rejection
      // (after the timer wins the race) does not escape as an
      // UnhandledPromiseRejection — capture-side errors must always be
      // swallowed to keep the caller's timeout propagating unchanged.
      capturePostLoadFailureInner(client, state).catch(() => undefined),
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

async function capturePostLoadFailureInner(
  client: CDPClient,
  state: CaptureCancellationState,
): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  // mkdtemp is the atomic fresh-directory primitive: it generates a
  // random suffix and creates the directory in one syscall, refusing
  // to follow any pre-existing symlink at the prefix.  This closes
  // the TOCTOU window that mkdir(recursive: true) leaves open — the
  // shared `lhremote-diagnostics` parent could otherwise be a
  // pre-existing symlink another local user controls, and recursive
  // mkdir would silently create our randomized child INSIDE the
  // attacker's target before any validation runs.  Using mkdtemp
  // directly under `os.tmpdir()` (no shared parent) means the only
  // directory in our path is the one we just created.
  const baseDir = await mkdtemp(join(tmpdir(), "lhremote-diagnostics-"));
  if (state.timedOut) return;
  // mkdtemp returns a fresh directory but mode is process-umask-
  // dependent on POSIX (typically 0o700 in Node 24+, but defensively
  // tightening here protects against umask drift).  ensureSecure-
  // DiagnosticDir also re-checks for symlink/non-directory shapes and
  // refuses if anything looks off.
  if (!(await ensureSecureDiagnosticDir(baseDir))) return;
  if (state.timedOut) return;
  const prefix = join(baseDir, `wait-for-post-load-${timestamp}`);

  const info = await client.evaluate<{
    href: string;
    title: string;
    hasMain: boolean;
    hasMainFeed: boolean;
    mainFeedListItemCount: number;
    mainFeedListItemsWithMenuButton: number;
    mainFeedListItemsViableForPostScrape: number;
    hasAuthorLink: boolean;
    hasAuthorLinkInMain: boolean;
    hasLtrSpans: boolean;
    hasArticles: boolean;
    hasReactLikeButton: boolean;
    hasCommentOnButton: boolean;
    hasTopLevelEditor: boolean;
    bodyTextSnippet: string;
  }>(`(() => {
    const mainFeed = document.querySelector('[data-testid="mainFeed"]');
    const listItems = mainFeed
      ? Array.prototype.slice.call(mainFeed.querySelectorAll('div[role="listitem"]'))
      : [];
    const itemsWithMenu = listItems.filter(function (item) {
      return item.querySelector('button[aria-label^="Open control menu for post"]') !== null;
    });
    // SCRAPE_POST_DETAIL_SCRIPT in get-post.ts also requires the item
    // to render with offsetHeight >= 100 (skips skeletons/hidden items
    // with zero or near-zero layout box).  Probe both the unfiltered
    // count (catch "menu-button selector still works but item is
    // hidden") and the scraper-equivalent count (catch "scraper would
    // skip every visible candidate") so Phase 2 can distinguish those.
    const viableItems = itemsWithMenu.filter(function (item) {
      return item.offsetHeight >= 100;
    });
    return {
      href: location.href,
      title: document.title,
      hasMain: document.querySelector('main') !== null,
      hasMainFeed: mainFeed !== null,
      mainFeedListItemCount: listItems.length,
      mainFeedListItemsWithMenuButton: itemsWithMenu.length,
      mainFeedListItemsViableForPostScrape: viableItems.length,
      hasAuthorLink: document.querySelector('${POST_AUTHOR_LINK_DOCUMENT_WIDE_SELECTOR}') !== null,
      hasAuthorLinkInMain: document.querySelector('${POST_READY_AUTHOR_LINK_SELECTOR}') !== null,
      hasLtrSpans: document.querySelectorAll('${POST_LTR_SPAN_FALLBACK_SELECTOR}').length > 0,
      hasArticles: document.querySelectorAll('article').length > 0,
      hasReactLikeButton: document.querySelector('${POST_REACT_LIKE_SELECTOR}') !== null,
      hasCommentOnButton: document.querySelector('${POST_COMMENT_ON_SELECTOR}') !== null,
      hasTopLevelEditor: document.querySelector('${POST_EDITOR_SELECTOR}') !== null,
      bodyTextSnippet: (document.body ? document.body.innerText : "").slice(0, 800),
    };
  })()`);
  if (state.timedOut) return;

  // 0o600: owner-only rw.  POSIX-only; no-op on Windows.
  await writeFile(`${prefix}.json`, JSON.stringify(info, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  if (state.timedOut) {
    // Cap fired after JSON landed but before screenshot.  Surface the
    // path NOW — the per-invocation mkdtemp directory is the only
    // place these artifacts live, so an early return without a warn
    // would leave operators unable to find them.
    console.warn(
      `[waitForPostLoad] timeout diagnostics partial: ${prefix}.json (screenshot skipped — capture cap reached)`,
    );
    return;
  }

  let wroteScreenshot = false;
  try {
    const screenshot = (await client.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
    })) as { data?: string };
    if (!state.timedOut && screenshot.data) {
      await writeFile(`${prefix}.png`, Buffer.from(screenshot.data, "base64"), {
        mode: 0o600,
      });
      wroteScreenshot = true;
    }
  } catch {
    // Screenshot is best-effort; info.json is the primary artifact.
  }

  // Unconditional warn — even if `state.timedOut` flipped during the
  // screenshot, we still have at least the JSON at the randomized
  // path, and the operator needs the path to find anything at all.
  // Mention `.png` only when actually written.
  const artifacts = wroteScreenshot ? "{json,png}" : "json";
  console.warn(
    `[waitForPostLoad] timeout diagnostics written: ${prefix}.${artifacts}`,
  );
}

/**
 * Validate the freshly-created diagnostic directory before writing
 * personal data into it.  Callers create the directory atomically via
 * `mkdtemp` so the path itself cannot be a symlink another user pre-
 * planted, but on POSIX `mkdtemp` honors the process umask — a loose
 * umask would produce a group/world-readable directory, so this
 * function `chmod`s back to `0o700` when needed.  Also defensively
 * re-`lstat`s and refuses on the (vanishingly rare) shapes where the
 * just-created path is a symlink or not a directory.
 *
 * Returns `true` when the directory is safe to write into, `false`
 * otherwise (caller short-circuits the capture).  POSIX-only concerns;
 * on Windows the mode bits and symlink semantics differ but this
 * check is still a no-op-or-pass.
 *
 * Exported for use by `wait-for-post-load`'s own diagnostic capture
 * AND `operations/navigate-to-profile.ts`'s navigation diagnostics —
 * both paths use the same `${tmpdir()}/lhremote-diagnostics-XXXXXX/`
 * mkdtemp pattern and the same threat model, so the validation
 * primitive is centralized here.
 */
export async function ensureSecureDiagnosticDir(
  baseDir: string,
): Promise<boolean> {
  let stats: Awaited<ReturnType<typeof lstat>>;
  try {
    stats = await lstat(baseDir);
  } catch {
    return false;
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    return false;
  }
  // Need to enforce the FULL `0o700` mode, not just strip group/world
  // bits.  Under a restrictive umask, mkdtemp can produce a directory
  // missing one of the owner's rwx bits (e.g. `0o600`), which would
  // pass an "any group/world bits" check while still failing the
  // subsequent writeFile because the owner lacks `x` (traverse) on
  // their own diagnostic dir.
  if ((stats.mode & 0o777) !== 0o700) {
    try {
      await chmod(baseDir, 0o700);
    } catch {
      // Could not tighten — refuse rather than write into a directory
      // that isn't reliably owner-rwx.
      return false;
    }
  }
  return true;
}
