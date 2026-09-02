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

// The label is operator-supplied and lands in the fixture's <title> and in an
// HTML comment, so it is escaped at both sites: `<`/`&`/quotes would otherwise
// emit invalid markup, and a `--` sequence would terminate the comment early
// and spill the rest of the header into the document.
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

const PORT = Number(process.env.LHREMOTE_CDP_PORT || DEFAULT_INSTANCE_CDP_PORT);
const SETTLE_MS = Number(process.env.LHREMOTE_SETTLE_MS || DEFAULT_SETTLE_MS);
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

const client = new CDPClient(PORT);
await client.connect(page.id);
try {
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
    process.exit(4);
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
    console.error("\nNothing was written.  Fix the scrub and re-run -- do not hand-edit a fixture.");
    process.exit(5);
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
} finally {
  client.disconnect();
}
