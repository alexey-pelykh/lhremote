// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Re-export the bin entry so `./run.js` resolves in THIS package too.
 *
 * That is the whole job, and it exists for a property rather than for tidiness.
 * `packages/{cli,lhremote}/src/cli.ts` are byte-identical (#933 AC-2, pinned by
 * `./cli-parity.test.ts`), and they achieve that with RELATIVE specifiers that
 * resolve per-package: `./run.js` and `./program.js`.  Without this file the
 * `lhremote` entrypoint would have to name `@lhremote/cli/run` directly, which
 * the `@lhremote/cli` one cannot, and the two would stop being identical.
 *
 * It re-exports and imports nothing else on purpose.  `@lhremote/cli/run` is a
 * subpath added in #963 precisely so this package can reach `run.js` without
 * going through `@lhremote/cli`'s `exports["."]`, which is `dist/program.js` —
 * the very graph the bin is deferring.  Loading this module therefore evaluates
 * `packages/cli/dist/run.js`, which has no value imports, and nothing heavy
 * loads before `runProgramBin`'s catch exists.  Adding an import here would
 * defeat that as surely as adding one there; see `packages/cli/src/run.ts`.
 */
export { runProgramBin } from "@lhremote/cli/run";
