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

    // Identifies what was read as a BIN ENTRYPOINT, not merely as non-empty.
    // This asserted `toContain("runProgram")` until #963, which made it weaker
    // than it looked: `runProgramBin` contains that token as a substring, so
    // the assertion survived the whole idiom changing underneath it and would
    // equally survive a file that had nothing else in common with an
    // entrypoint. The shebang is what only these two files carry.
    for (const source of [lhremote, cli]) {
      expect(source.startsWith("#!/usr/bin/env node\n")).toBe(true);
    }
  });

  it("keeps packages/{cli,lhremote}/src/cli.ts byte-identical", () => {
    expect(lhremote).toBe(cli);
  });

  it("delegates rather than parsing argv itself", () => {
    // The divergence that matters is not cosmetic: it is one entrypoint going
    // back to commander's synchronous `.parse()`, which is the #933 defect.
    for (const source of [lhremote, cli]) {
      expect(source).not.toMatch(/\.parse\(\)/);
      expect(source).toContain(
        'runProgramBin(async () => (await import("./program.js")).createProgram())',
      );
    }
  });

  it("keeps createProgram() inside the covered region", () => {
    // #963 AC-2, at the level where it is actually decided. `runProgramBin`
    // invokes the thunk inside its own `try`, so the `./program.js` import and
    // the `createProgram()` call are both reported when they throw. The
    // superseded idiom — `runProgram(createProgram())` — called it in argument
    // position, before `runProgram` was entered, which put a throw from either
    // back in the ESM loader's hands as a crash dump.
    //
    // Asserted as the ABSENCE of the old call shape rather than only as the
    // presence of the new one: a file could contain both, and it is the old one
    // that reopens the defect. Measured on the built bins with a throw injected
    // into `createProgram()`: 12-line dump under the old idiom, one diagnosed
    // line under this one, exit 1 either way — which is why the exit code alone
    // does not discriminate.
    for (const source of [lhremote, cli]) {
      expect(source).not.toContain("runProgram(createProgram())");
    }
  });

  it("reaches its program and its runner by relative specifier", () => {
    // This is the mechanism the byte-identity above RESTS on, so it is worth
    // stating separately: `./run.js` and `./program.js` resolve per-package, so
    // one file can be the entrypoint of both packages. Naming either through
    // its package specifier — `@lhremote/cli/run`, say — would work in exactly
    // one of the two and end the parity. `packages/lhremote/src/run.ts` exists
    // to make `./run.js` resolve on this side (#963).
    for (const source of [lhremote, cli]) {
      expect(source).toContain('from "./run.js"');
      expect(source).toContain('import("./program.js")');
      expect(source).not.toContain("@lhremote/cli");
    }
  });
});
