// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const lhremote = read("./cli.ts");
const cli = read("../../cli/src/cli.ts");

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
    // that reopens the defect. Measured on both built bins with a throw
    // injected into `createProgram()`: 13-line dump under the old idiom, one
    // line under this one, exit 1 either way — which is why the exit code alone
    // does not discriminate. One here and three for the forced
    // `require("../package.json")` fault elsewhere in this change, because the
    // after-count is the error's own: this injected message is a single line.
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

/**
 * The header of `cli.ts` states its own invariant twice — "that import is the
 * whole of this file's graph, and it has to stay that way", and then again for
 * the thunk — and until this block nothing held either.  The suite above pins
 * what the file DOES contain; a second `import` line is invisible to every one
 * of those assertions, and byte-identity would happily carry it into both
 * packages at once.
 *
 * Same instrument as `packages/cli/src/run.test.ts`'s equivalent block, and
 * for the same reason: this file's own subject is mostly prose ABOUT imports,
 * so a regex over it matches comment text.  Read with the TypeScript parser
 * instead.
 *
 * The two invariants are separated deliberately.  A value import is the #963
 * defect itself — its graph evaluates before `runProgramBin`'s `try` exists.
 * A type-only import is erased under `verbatimModuleSyntax` and evaluates
 * nothing, so it is admissible; what makes THIS file's single import the one it
 * is allowed is that `./run.js` is where the catch lives.
 */
describe("bin entrypoint import graph", () => {
  /** Every static `import` / `export … from` in `text`, with its type-only flag. */
  function staticSpecifiers(
    text: string,
    fileName: string,
  ): { spec: string; typeOnly: boolean }[] {
    const file = ts.createSourceFile(
      fileName,
      text,
      ts.ScriptTarget.ESNext,
      true,
      ts.ScriptKind.TS,
    );

    return file.statements.flatMap((statement) => {
      if (
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        return [
          {
            spec: statement.moduleSpecifier.text,
            typeOnly: statement.importClause?.isTypeOnly ?? false,
          },
        ];
      }

      if (
        ts.isExportDeclaration(statement) &&
        statement.moduleSpecifier !== undefined &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        return [
          { spec: statement.moduleSpecifier.text, typeOnly: statement.isTypeOnly },
        ];
      }

      return [];
    });
  }

  it("parses imports rather than matching them, canaried against a file that has more", () => {
    // The positive control for the instrument.  `./program.ts` carries two
    // static imports where `cli.ts` carries one, so a parser that silently
    // found nothing would be caught here rather than reported as a clean
    // entrypoint.
    const program = staticSpecifiers(
      read("./program.ts"),
      "program.ts",
    ).filter((i) => !i.typeOnly);

    expect(program.map((i) => i.spec)).toContain("@lhremote/cli");
    expect(program.length).toBeGreaterThan(1);
  });

  it("declares exactly one static import, and it is ./run.js", () => {
    // Named rather than counted: a red here should tell the author WHICH
    // specifier they added.  `./run.js` is admissible because it is the file
    // whose `try` covers everything else, and it carries no value import of
    // its own — pinned in `packages/cli/src/run.test.ts`, which is the other
    // half of this invariant and not restated here.
    for (const [name, source] of [
      ["lhremote", lhremote],
      ["cli", cli],
    ] as const) {
      expect({ name, specs: staticSpecifiers(source, `${name}/cli.ts`) }).toEqual({
        name,
        specs: [{ spec: "./run.js", typeOnly: false }],
      });
    }
  });
});
