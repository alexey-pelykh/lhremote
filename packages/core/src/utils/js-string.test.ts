// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { describe, expect, it } from "vitest";
import { jsString } from "./js-string.js";

// Deliberately NOT `expect(jsString(x)).toBe(JSON.stringify(x))`. That restates
// the implementation and would pass for any implementation that happens to be
// the current one, including a wrong one adopted later. What these grade is the
// CONTRACT the three call sites depend on: the returned text, pasted into a
// JavaScript program, is a string literal that a parser accepts and that
// evaluates back to the original value.
describe("jsString", () => {
  /** Parse the emitted literal the way an in-page `Runtime.evaluate` would. */
  const evaluate = (literal: string): unknown =>
    new Function(`return ${literal};`)();

  it("round-trips values through a JavaScript parser", () => {
    // Each entry is a character class that breaks hand-quoting. The first two
    // are the live hazard: LinkedIn selectors carry double quotes today
    // (`[href*="/in/"]`), and an apostrophe is what a `'${CONST}'` site would
    // emit as a syntax error.
    for (const value of [
      'a[href*="/in/"], a[href*="/company/"]',
      "button[aria-label='All reactions']",
      String.raw`div[data-x="a\b"]`,
      "both ' and \" together",
      "trailing backslash \\",
      "newline\nand\ttab",
      "",
    ]) {
      const literal = jsString(value);
      expect(() => evaluate(literal), `unparseable: ${value}`).not.toThrow();
      expect(evaluate(literal), `round-trip: ${value}`).toBe(value);
    }
  });

  it("emits a self-delimiting literal, not a bare quoted value", () => {
    // The property that makes interpolation safe at all: the result carries its
    // own delimiters, so a call site writes `querySelector(${jsString(s)})`
    // with no quotes of its own. A helper returning the raw value — or one
    // quoting without escaping — would leave the call site's quotes load-
    // bearing again, which is the defect this module exists to remove.
    const value = 'main button[aria-label^="React Like to "]';
    const literal = jsString(value);

    expect(literal.startsWith('"')).toBe(true);
    expect(literal.endsWith('"')).toBe(true);
    // The inner quotes must be escaped rather than passed through: unescaped,
    // they would close the literal early and change what the page executes.
    expect(literal).not.toContain('"main button[aria-label^="React');
    expect(evaluate(literal)).toBe(value);
  });

  it("keeps a quote-bearing selector intact inside a larger emitted program", () => {
    // The call sites do not evaluate the literal alone; they splice it into
    // surrounding source. This is the smallest form of that.
    const selector = "a[href*='/in/']";
    const source = `(() => document.querySelector(${jsString(selector)}))()`;

    const asked: string[] = [];
    const run = new Function(
      "document",
      `return ${source};`,
    ) as (doc: { querySelector: (s: string) => null }) => unknown;
    run({
      querySelector: (s: string) => {
        asked.push(s);
        return null;
      },
    });

    expect(asked).toEqual([selector]);
  });
});
