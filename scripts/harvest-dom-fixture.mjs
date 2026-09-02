#!/usr/bin/env node

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

// Harvest a LinkedIn post-detail DOM fixture from a live LinkedHelper session,
// reduce it to the subtree the adapters read, and scrub every identifying value.
//
// The fixture's job is to catch a DOM variant flip before merge -- per ADR-004,
// T3 E2E never runs in CI, so Tier 2 is the only tier that can gate one.  That
// job needs the STRUCTURE to be faithful, so scrubbing replaces VALUES and never
// removes or renames an element, a class or an attribute.  It also preserves
// every value the oracle asserts on (engagement counts, entity cardinality),
// because a fixture whose counts were scrubbed could not exercise the
// corroborator it exists to test.
//
//   node scripts/harvest-dom-fixture.mjs <post-url> <out.html> [--label NAME]
//
// Reads only.  It navigates the existing webview and serialises a DETACHED deep
// clone; the live page is never mutated.  No click, reaction, comment, follow or
// message is performed.
//
// The scrub itself lives in scripts/lib/harvest-scrub.js and is read verbatim
// rather than embedded here as a template literal -- inside a template every
// backslash needs doubling, and one missed pair silently truncates a regex.
//
// Exit codes: 2 usage - 3 no LinkedIn target - 4 no legacy container on the page
//             5 a gate tripped -- a name, an identifier, an unrecognised URL,
//               or a network-reachable asset survived; nothing is written
//             6 packages/core is not built
// packages/core/dist is BUILD OUTPUT and is absent from a fresh checkout, so
// these are imported dynamically behind an existence check: a bare static import
// fails with a module-resolution stack trace that says nothing about the actual
// remedy, which is to build core first.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const [, , POST_URL, OUT, ...rest] = process.argv;
if (!POST_URL || !OUT) {
  console.error("usage: harvest-dom-fixture.mjs <post-url> <out.html> [--label NAME]");
  process.exit(2);
}
// `--label` must carry a value.  A trailing `--label`, or one followed by
// another flag, previously yielded `undefined` and embedded the string
// "undefined" into the fixture header and its .measured.json sidecar -- a
// silently mislabelled artifact rather than an error.
const labelIdx = rest.indexOf("--label");
if (labelIdx !== -1) {
  const next = rest[labelIdx + 1];
  if (next === undefined || next.startsWith("--")) {
    console.error("usage: harvest-dom-fixture.mjs <post-url> <out.html> [--label NAME]");
    console.error("       --label requires a value");
    process.exit(2);
  }
}
const LABEL = labelIdx !== -1 ? rest[labelIdx + 1] : "fixture";

// The label is operator-supplied and lands in two places that need DIFFERENT
// treatment, so each gets its own escape rather than one shared pass:
//   <title>       -- full entity escaping.  `&` and `<` would otherwise emit
//                    invalid markup, and quotes are escaped for the same reason
//                    the helper is reusable in an attribute.
//   HTML comment  -- `--` collapsed and `<`/`>` stripped.  A `--` sequence
//                    terminates the comment early and spills the rest of the
//                    header into the document.  `&` and quotes are inert inside
//                    a comment and are deliberately NOT escaped: entity-escaping
//                    there would put a literal `&amp;` in front of the reader.
const escapeHtml = (v) => String(v)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const LABEL_HTML = escapeHtml(LABEL);
const LABEL_COMMENT = String(LABEL).replace(/-{2,}/g, "-").replace(/[<>]/g, "");

// Capture tuning.  These are wall-clock waits against a live, network-bound page,
// so they are deliberately generous: harvesting early yields a fixture missing
// the comment thread, which fails silently -- it looks like a legitimately empty
// post, which is exactly the defect these fixtures exist to catch.
/** CDP port of the LinkedHelper *instance* (not the launcher). */
const DEFAULT_INSTANCE_CDP_PORT = 62104;
/** Wait after navigation before reading -- covers post-detail hydration. */
const DEFAULT_SETTLE_MS = 8000;
/** Scroll passes used to page the comment thread in, and the pause between them. */
const COMMENT_SCROLL_PASSES = 3;
const SCROLL_STEP_PX = 1500;
const SCROLL_SETTLE_MS = 1500;
/** Pause after scrolling back to the top, so lazy content settles before cloning. */
const TOP_SETTLE_MS = 800;

// Both overrides are validated rather than passed through Number(), because
// both failure modes are SILENT and one of them corrupts the artifact.  A
// non-numeric port yields `http://127.0.0.1:NaN/...` -- confusing, but loud.  A
// non-numeric settle yields setTimeout(NaN), which fires IMMEDIATELY: the page
// is cloned before the comment thread loads and the fixture comes out short,
// looking exactly like a legitimately empty post. That is the defect these
// fixtures exist to catch, so the harvester must not be able to manufacture it.
// `integer` and `max` are per-variable rather than blanket, because the two
// values have genuinely different domains.  A port must be a whole number in
// the TCP range -- 62104.5 is finite and positive, so a bare finiteness check
// passes it, and it then reaches discoverTargets() as
// `http://127.0.0.1:62104.5/json/list`, failing later as a confusing connection
// error rather than here as a bad value.  A settle of 1500.5 ms is meanwhile
// perfectly valid and there is no ceiling worth inventing for it.
const readNumericEnv = (name, fallback, { min, max, integer }) => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  const bad = !Number.isFinite(n)
    || n < min
    || (max !== undefined && n > max)
    || (integer && !Number.isInteger(n));
  if (bad) {
    const want = (integer ? "an integer" : "a finite number")
      + ` >= ${min}` + (max !== undefined ? ` and <= ${max}` : "");
    console.error(`${name}=${JSON.stringify(raw)} is not ${want}.`);
    console.error(`Unset it to use the default (${fallback}), or give it a valid value.`);
    process.exit(2);
  }
  return n;
};
const PORT = readNumericEnv("LHREMOTE_CDP_PORT", DEFAULT_INSTANCE_CDP_PORT,
  { min: 1, max: 65535, integer: true });
const SETTLE_MS = readNumericEnv("LHREMOTE_SETTLE_MS", DEFAULT_SETTLE_MS, { min: 0 });
const CORE_DIST = join(HERE, "..", "packages", "core", "dist");
if (!existsSync(join(CORE_DIST, "cdp", "client.js"))) {
  console.error("packages/core is not built -- this script imports its compiled CDP client.");
  console.error("Run:  pnpm --filter @lhremote/core build");
  process.exit(6);
}
const { CDPClient } = await import(pathToFileURL(join(CORE_DIST, "cdp", "client.js")).href);
const { discoverTargets } = await import(
  pathToFileURL(join(CORE_DIST, "cdp", "discovery.js")).href);

const SCRUB_SRC = readFileSync(join(HERE, "lib", "harvest-scrub.js"), "utf8");

const targets = await discoverTargets(PORT, "127.0.0.1");
const page = targets.find((t) => t.type === "page" && t.url?.includes("linkedin.com"));
if (!page) {
  console.error("No LinkedIn target -- is LinkedHelper running with an active session?");
  process.exit(3);
}

// Failure exits inside the try below are thrown, not `process.exit()`ed.
//
// Observed: `process.exit()` skips the `finally`, so `client.disconnect()` never
// runs on either failure path.  Measured against this exact control flow -- the
// throwing form emits the finally's line, the exiting form does not.  On its own
// that is minor, since the process is about to die and take the socket with it.
//
// The reason it is worth fixing anyway is the documented `process.exit()` hazard
// it sits next to: exit does not wait for pending stdout/stderr writes to flush,
// and those streams are pipes whenever the run is piped through `tail`/`less` or
// captured by CI.  The refusal path prints a long five-gate diagnostic
// immediately before exiting, and that report is the whole point of the gate.
// This did NOT reproduce at 400 lines on this host -- it is a latent risk, not a
// measured failure -- but throwing removes it for free, because the process then
// ends naturally and Node flushes on its own.
class HarvestExit extends Error {
  constructor(code) {
    super(`harvest exit ${code}`);
    this.code = code;
  }
}

// `connect` sits INSIDE the try so the cleanup guarantee holds on every failure
// path, including a target that disappears between discovery and attach.  Safe
// because `disconnect()` is idempotent on a client that never connected -- it
// null-guards the socket and `rejectAllPending` no-ops on an empty set -- so the
// finally cannot mask the original error with a secondary one.
const client = new CDPClient(PORT);
try {
  await client.connect(page.id);
  await client.navigate(POST_URL);
  await sleep(SETTLE_MS);
  // Load the comment thread the way a reader would.
  for (let i = 0; i < COMMENT_SCROLL_PASSES; i++) {
    await client.evaluate(`window.scrollBy(0, ${SCROLL_STEP_PX})`);
    await sleep(SCROLL_SETTLE_MS);
  }
  await client.evaluate("window.scrollTo(0, 0)");
  await sleep(TOP_SETTLE_MS);

  const result = await client.evaluate(SCRUB_SRC);

  if (result.error) {
    console.error("HARVEST FAILED:", JSON.stringify(result, null, 2));
    throw new HarvestExit(4);
  }
  console.error("measured (pre-scrub):", JSON.stringify(result.measured, null, 2));
  console.error("scrub report:", JSON.stringify(result.scrub, null, 2));

  if (result.blocked) {
    console.error("\nREFUSING TO WRITE -- residual-identity gate tripped.");
    const names = result.scrub.suspectedResidualNames ?? [];
    const ids = result.scrub.suspectedResidualIds ?? [];
    if (names.length > 0) {
      console.error("\nSuspected residual NAMES (text nodes and name-bearing attributes):");
      for (const n of names) console.error("   " + n);
      console.error("\n  -> Extend NAME_SLOT_PATTERNS in scripts/lib/harvest-scrub.js, or add the");
      console.error("     token to UI_VOCAB if it is LinkedIn UI vocabulary rather than a person.");
    }
    if (ids.length > 0) {
      console.error("\nSuspected residual IDENTIFIERS (anywhere in the serialised fixture):");
      for (const i of ids) console.error("   " + i);
      console.error("\n  -> Extend scrubUrls/URN_ANY in scripts/lib/harvest-scrub.js.  Note the");
      console.error("     three axes an identifier can hide behind: percent-encoding, an");
      console.error("     underscore in the type name, and an opaque non-numeric id.");
    }
    const fetches = result.scrub.residualFetchUrls ?? [];
    if (fetches.length > 0) {
      console.error("\nDereferenceable URLs left in fetch-triggering attributes:");
      for (const u of fetches) console.error("   " + u);
      console.error("\n  -> These make the fixture reach the network on load, which breaks the");
      console.error("     no-network contract of the Tier-2 suite.  Neutralise them to the");
      console.error("     inline BLANK_ASSET in scripts/lib/harvest-scrub.js.");
    }
    const urls = result.scrub.residualUrls ?? [];
    if (urls.length > 0) {
      console.error("\nAbsolute URLs that are not on the allowlist:");
      for (const u of urls) console.error("   " + u);
      console.error("\n  -> URL handling is an ALLOWLIST, so anything printed here is by");
      console.error("     definition unscrubbed.  Only w3.org namespaces, /in/test-person-");
      console.error("     profile links and the redaction placeholder are permitted.");
    }
    const nums = result.scrub.residualNumerics ?? [];
    if (nums.length > 0) {
      console.error("\nReal numbers surviving in synthesised prose:");
      for (const n of nums) console.error("   " + n);
      console.error("\n  -> Synthesised text may contain no digit but the marker `1`.  Anything");
      console.error("     else came off the live page -- a statistic, an id, a phone number --");
      console.error("     and contradicts the fixture's own claim that its prose is synthetic.");
    }
    console.error("\nNothing was written.  Fix the scrub and re-run -- do not hand-edit a fixture.");
    throw new HarvestExit(5);
  }

  // The live URL identifies the account; provenance keeps the SHAPE, not the URL.
  const measuredPublic = { ...result.measured };
  measuredPublic.href = "(redacted -- a live legacy post-detail page)";

  const doc = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${LABEL_HTML} -- scrubbed LinkedIn post-detail fixture (legacy dialect)</title>
</head>
<body>
<!--
  SCRUBBED FIXTURE -- generated by scripts/harvest-dom-fixture.mjs
  Dialect: legacy    Label: ${LABEL_COMMENT}
  Harvested: ${new Date().toISOString()}

  Every person name, profile slug, headline, body text, image URL and URN digit
  below is SYNTHETIC.  Structure, class names, data-* attributes, aria-label
  SHAPES and engagement counts are verbatim from the live page: those are what
  the adapters key on and what the oracle asserts.

  Pre-scrub measurements of the page this came from:
${JSON.stringify(measuredPublic, null, 4).split("\n").map((l) => "    " + l).join("\n")}
-->
<main>
${result.html}
</main>
</body>
</html>
`;
  writeFileSync(OUT, doc, "utf8");
  writeFileSync(
    OUT.replace(/\.html$/, "") + ".measured.json",
    JSON.stringify({ label: LABEL, measured: measuredPublic, scrub: result.scrub }, null, 2) + "\n",
    "utf8",
  );
  console.error(`WROTE ${OUT} (${doc.length} bytes)`);
} catch (err) {
  // A real failure must still surface with its stack; only the deliberate
  // early-exit sentinel is converted into an exit code.
  if (!(err instanceof HarvestExit)) throw err;
  process.exitCode = err.code;
} finally {
  client.disconnect();
}
