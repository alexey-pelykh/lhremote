// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Emit a JavaScript string literal for a value crossing the TS→JS seam.
 *
 * `JSON.stringify` is the right primitive here rather than wrapping in
 * quotes: selectors legitimately contain both quote characters (`[href*="/in/"]`)
 * and backslashes, and hand-quoting silently produces a syntax error or, worse,
 * a valid-but-different selector.
 *
 * **Why this is one function rather than the rule written at each site.**
 * Every module that builds in-page source for `Runtime.evaluate` faces the same
 * hazard, and nothing in the type system notices when a site gets it wrong: a
 * hand-quoted `'${SELECTOR}'` compiles and lints. Restating the rule per site
 * means each new site re-decides it, and the sites that got it wrong were
 * indistinguishable from the ones that got it right until someone read them.
 * With one named callee the question at a site becomes "does this go through
 * `jsString`?", which is greppable, rather than "is this quoting correct?",
 * which is not.
 *
 * Deliberately scoped to a single string. A list of strings emitted as an
 * in-page *array* literal is a different emission — `JSON.stringify` applied to
 * the array, which quotes each member and brackets the whole — and callers that
 * need one say so directly rather than reaching for this.
 */
export function jsString(value: string): string {
  return JSON.stringify(value);
}
