#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { runProgramBin } from "./run.js";

// That import is the whole of this file's graph, and it has to stay that way.
// `./run.js` has no value imports of its own precisely so that nothing is
// evaluated before its catch exists; a second `import` here would be evaluated
// the same way and put its throw back in the ESM loader's hands as a crash
// dump (#963).  Both `./run.js` and `./program.js` resolve per-package, which
// is what lets `packages/{cli,lhremote}/src/cli.ts` stay byte-identical while
// each loads its own program — the property `cli-parity.test.ts` pins (#933).
//
// The program is loaded through a THUNK rather than imported at the top, and
// that is the whole of #963's fix on this side.  `import { createProgram }`
// here would evaluate `./program.js` — its `require("../package.json")`, every
// handler under `./handlers/`, `commander`, `@lhremote/core` and its graph —
// before `runProgramBin` was ever entered, so a throw in any of it escaped
// into the loader.  Invoked inside that function's `try`, both the import and
// the `createProgram()` call it wraps are reported instead.  Moving either back
// to module scope silently re-opens the hole.
//
// `void`, not top-level await.  `runProgramBin` handles its own rejection, so
// there is nothing here to await for correctness — and awaiting would make
// this module async, which breaks `require()` of any package whose `exports`
// resolve to this file (measured: ERR_REQUIRE_ASYNC_MODULE).  That is a
// conditional, and `packages/mcp/src/index.ts` records which side of it each
// package sits on; do not flatten it into a claim about both.
void runProgramBin(async () => (await import("./program.js")).createProgram());
