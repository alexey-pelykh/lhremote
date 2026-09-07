// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Resolve relative to THIS file so the config behaves the same regardless of
// the cwd vitest is invoked from.  Each package runs a bare `vitest run` from
// its own directory and vitest resolves this config from the workspace root,
// leaving `root` at the package — so a path relative to the config would be
// looked up under `packages/<name>/` and silently miss.  Same reasoning as
// vitest.e2e.config.ts.
const CONFIG_DIR = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    // Tier-1 guard: fails any unit test that reaches the live network, so a
    // suite cannot depend on machine state again (#909, ADR-004).  Exempts
    // *.integration.test.ts from inside — see vitest.setup.ts.
    setupFiles: [`${CONFIG_DIR}vitest.setup.ts`],
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.e2e.test.ts"],
    coverage: {
      provider: "v8",
      all: true,
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
      // Package-relative on purpose.  Every package runs a bare `vitest run`
      // from its own directory, so `root` is `packages/<name>/` and this glob
      // resolves to that package's own sources.  It deliberately does NOT use
      // CONFIG_DIR the way `setupFiles` above does: an absolute repo-root glob
      // would pull every package's sources into every package's report, so
      // core's run would grade cli and mcp at 0%.
      //
      // This pattern is also the switch for untested files: coverage-v8 walks
      // them only when this key is non-null (`this.options.include != null`
      // in its provider), globbing it against `root`.  The previous
      // `packages/*/src/**/*.ts` resolved to `packages/<name>/packages/*/src/`
      // and matched nothing, so the walk found nothing — only files a test
      // imported were graded, an untested file could not lower the
      // thresholds, and lhremote (whose sole source file no test imports)
      // reported an empty table that passed the gate at 0% (#930).  The
      // `all: true` above is a vitest 1-3 option that 4.x ignores (it is
      // absent from `coverageConfigDefaults` and read nowhere in
      // @vitest/coverage-v8), so it is this key doing the work: never drop
      // `include` on the assumption that `all` still covers it.
      include: ["src/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "**/*.e2e.test.ts",
        "**/*.d.ts",
        "**/testing/**",
        // Bin entrypoints — exactly the files each package names in its
        // `bin` field.  Each parses argv or starts a server at module scope,
        // so importing one runs the program instead of testing it and none can
        // be exercised in-process; each delegates in a single statement to an
        // importable module (program.ts, stdio.ts) that is measured normally.
        // Excluded uniformly rather than only where a package would otherwise
        // miss its threshold: the claim is that the measurement does not apply
        // to them, not that a number needed help.  Named by full package path
        // so a bare `src/index.ts` cannot also catch core's public barrel,
        // which is not an entrypoint and stays measured.  These are matched
        // against absolute paths, not against `root`; the `**/` prefix says so
        // explicitly rather than leaning on substring matching.  Verified by
        // removing them: cli 77->78, mcp 79->80, lhremote 4/4->4/5 files.
        "**/packages/cli/src/cli.ts",
        "**/packages/lhremote/src/cli.ts",
        "**/packages/mcp/src/index.ts",
      ],
      thresholds: {
        statements: 85,
        branches: 69,
        functions: 80,
        lines: 85,
      },
    },
  },
});
