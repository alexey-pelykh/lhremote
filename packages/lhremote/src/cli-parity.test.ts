// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Acceptance criterion 2 of #933 — "when either is changed, then both use the
 * same parse idiom, so they do not diverge" — is a standing property, and
 * nothing else in the repo holds it.  Both entrypoints are excluded from the
 * coverage gate as bin entrypoints (`vitest.config.ts`), so a one-sided edit
 * to either would land green.  This is the gate.
 *
 * It lives here rather than in `@lhremote/cli` because `lhremote` already
 * depends on that package; the reverse would point a check back up its own
 * dependency edge.  It reads sources, not builds: the property is about what
 * the two files say, and `dist/` is not published from this test's tree.
 */
describe("bin entrypoint parity", () => {
  const read = (relative: string) =>
    readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

  const lhremote = read("./cli.ts");
  const cli = read("../../cli/src/cli.ts");

  it("reads both entrypoints, so the comparison is not vacuous", () => {
    // Without this, a bad path that threw would be the only signal, and a
    // path that resolved to two empty files would compare equal and pass.
    expect(lhremote.length).toBeGreaterThan(0);
    expect(cli.length).toBeGreaterThan(0);
    expect(lhremote).toContain("runProgram");
  });

  it("keeps packages/{cli,lhremote}/src/cli.ts byte-identical", () => {
    expect(lhremote).toBe(cli);
  });

  it("delegates rather than parsing argv itself", () => {
    // The divergence that matters is not cosmetic: it is one entrypoint going
    // back to commander's synchronous `.parse()`, which is the #933 defect.
    for (const source of [lhremote, cli]) {
      expect(source).not.toMatch(/\.parse\(\)/);
      expect(source).toContain("runProgram(createProgram())");
    }
  });
});
