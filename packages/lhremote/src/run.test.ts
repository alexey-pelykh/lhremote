// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";

import { runProgramBin } from "./run.js";

/**
 * `./run.ts` is one re-export, and it is load-bearing twice over, so it is
 * worth the file it takes to hold it (#963).
 *
 * It is what makes `./run.js` RESOLVE in this package, which is what lets
 * `packages/{cli,lhremote}/src/cli.ts` stay byte-identical while each loads its
 * own program — the #933 property `./cli-parity.test.ts` pins.
 *
 * What this file does NOT do is move a coverage number, and that is worth
 * saying because it is the obvious reason to assume it exists.  Measured both
 * ways at `bc5578b`: `./run.ts` reports 0/0/0/0 whether or not this suite is
 * present, and the package total stays 100% either way, because a bare
 * re-export compiles to no executable statement for v8 to count.  So the
 * coverage gate is indifferent to this file. What it buys is the two
 * assertions below — that the new `@lhremote/cli/run` subpath resolves at all,
 * and that it yields the same function the bin will run.  Nothing else in the
 * repo would notice if that subpath were dropped from
 * `packages/cli/package.json` until a built bin failed to start.
 */
describe("lhremote bin entry", () => {
  it("re-exports a callable runProgramBin", () => {
    expect(typeof runProgramBin).toBe("function");
  });

  it("resolves the @lhremote/cli/run subpath, and to the same function", async () => {
    // The subpath is new in #963 and exists because `@lhremote/cli`'s
    // `exports["."]` is `dist/program.js` — the very graph the bin is
    // deferring, so reaching `run.js` through it would defeat the fix.
    // Identity rather than shape: two copies of the function would both be
    // callable and only one of them would be the one the bin runs.
    const fromCli = await import("@lhremote/cli/run");

    expect(runProgramBin).toBe(fromCli.runProgramBin);
  });
});
