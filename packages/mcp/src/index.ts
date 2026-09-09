#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { runStdioBin } from "./run.js";

// That import is the whole of this file's graph, and it has to stay that way.
// `./run.js` has no static imports of its own precisely so that nothing is
// evaluated before its catch exists; a second `import` here would be evaluated
// the same way and put its throw back in the ESM loader's hands as a crash
// dump (#959).  Nothing detects that: this file is excluded from the coverage
// gate as a bin entrypoint, and the test that pins the invariant imports
// `./run.js`, not this module — importing this one starts the server.
//
// `void`, not top-level await.  `runStdioBin` handles its own rejection, so
// there is nothing here to await for correctness, and leaving this module
// synchronous costs nothing.
//
// The reason `packages/{cli,lhremote}/src/cli.ts` give for the same idiom is
// NOT the reason here, and must not be copied in.  This paragraph used to say
// the two differed on whether `exports` resolves to the bin — that
// `packages/lhremote`, whose `exports["."]` and `bin` are both `./dist/cli.js`,
// could be `require()`d into an ERR_REQUIRE_ASYNC_MODULE where `packages/cli`
// could not.  #963 measured it and that discriminator does not exist: an
// `exports` entry declaring only `types` and `import` — which is every entry in
// this repo — is never matched by `require()`, so `require("lhremote")` is
// refused at RESOLUTION with ERR_PACKAGE_PATH_NOT_EXPORTED, identically with
// and without a top-level await, exactly as `require()` of this package's
// undeclared `./dist/index.js` subpath is.  All three bins sit on the same side.
//
// What survives, and it is what those files now state: a top-level await really
// does make the module un-`require()`able, by the route that bypasses `exports`
// — `require()` of the built file by absolute path, measured raising
// ERR_REQUIRE_ASYNC_MODULE with the await and returning without it.  So the
// idiom is right on all three; it was the conditional that was wrong.
//
// What `void` does depend on is the catch inside `runStdioBin`: a `void` over
// a function that let its own rejection escape would exit 0 with an empty
// stderr under `--unhandled-rejections=none` — measured, and a silent success
// for a server that never started.  The two go together (#945).
void runStdioBin();
