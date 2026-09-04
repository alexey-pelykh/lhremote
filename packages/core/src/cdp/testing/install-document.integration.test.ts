// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CDPClient } from "../client.js";
import { CDPTimeoutError } from "../errors.js";
import {
  EMPTY_DOCUMENT_HTML,
  INSTALL_TEST_TIMEOUT_MS,
  installDocument,
} from "./install-document.js";
import { launchChromium, type ChromiumInstance } from "./launch-chromium.js";

/** Timeout for beforeEach operations (connect) on slow CI runners. */
const BEFORE_EACH_TIMEOUT = 15_000;

/**
 * The install gate, graded against a real browser.
 *
 * The unit tier grades the gate's *shape* — that it polls, that it cannot
 * return before an evaluation reports the marker, that it throws instead of
 * returning when one never does.  It grades all of that against a scripted
 * stand-in, which by construction cannot witness the thing #888 is actually
 * about: what a real `Runtime.evaluate` sees after a real
 * `Page.setDocumentContent`.
 *
 * This tier closes that gap.  Every assertion here reads the live document
 * with **no caller-side wait of any kind** — which is precisely the shape that
 * flaked before, so a regression re-opens as a failure here rather than as one
 * canary in 2068 on the windows runner.
 */
describe("installDocument (integration)", { timeout: INSTALL_TEST_TIMEOUT_MS }, () => {
  let chromium: ChromiumInstance;
  let client: CDPClient;

  beforeAll(async () => {
    chromium = await launchChromium();
  }, 30_000);

  afterAll(async () => {
    await chromium.close();
  });

  beforeEach(async () => {
    client = new CDPClient(chromium.port, { timeout: BEFORE_EACH_TIMEOUT });
    await client.connect();
  }, BEFORE_EACH_TIMEOUT);

  afterEach(() => {
    client.disconnect();
  });

  /** Count elements matching a selector, exactly as the fixture canaries do. */
  async function count(selector: string): Promise<number> {
    return client.evaluate<number>(
      `document.querySelectorAll(${JSON.stringify(selector)}).length`,
    );
  }

  const PAGE = `<!doctype html><html><head></head><body>${'<div role="listitem"></div>'.repeat(3)}</body></html>`;

  it("leaves the installed markup immediately countable, with no caller-side wait", async () => {
    await installDocument(client, PAGE);

    expect(await count('div[role="listitem"]')).toBe(3);
  });

  it("holds across repeated installs, which is where the flake lived", async () => {
    // One install proves little: the failure this closes was ~1 canary in 2068
    // on a slow runner.  A tight loop is not a proof either — the construction
    // is the proof — but it is the cheapest way to keep an accidental
    // regression from needing a full windows suite to surface.
    //
    // Scoped honestly: rounds 2..25 add nothing over round 1 against a
    // DETERMINISTIC regression, and against a fault as rare as the one being
    // closed they add a fraction of a percent — worth stating so nobody reads
    // the round count as the evidence.  What they do cover is state leaking
    // between installs — residue accumulating, a token colliding with its
    // predecessor — which a single round cannot see at all.
    for (let round = 0; round < 25; round++) {
      await installDocument(client, PAGE);
      expect(await count('div[role="listitem"]')).toBe(3);
    }
  }, 60_000);

  it("hands back the caller's markup, with no residue from the marker", async () => {
    await installDocument(client, PAGE);

    expect(await count('meta[name^="lhremote-"]')).toBe(0);
    expect(await client.evaluate<string>("document.documentElement.outerHTML")).toBe(
      '<html><head></head><body><div role="listitem"></div><div role="listitem"></div><div role="listitem"></div></body></html>',
    );
  });

  it("preserves the document's own compatibility mode, either way", async () => {
    // The marker is appended after the caller's markup, so it can never reach
    // the front of the stream where the doctype decides this.  Asserted in
    // BOTH directions: a check that only ever sees standards mode would pass
    // just as happily if the mode were pinned rather than preserved.
    await installDocument(client, PAGE);
    expect(await client.evaluate<string>("document.compatMode")).toBe("CSS1Compat");

    await installDocument(client, "<html><body><p>quirks</p></body></html>");
    expect(await client.evaluate<string>("document.compatMode")).toBe("BackCompat");
  });

  it("is not satisfied by the document a previous install left behind", async () => {
    await installDocument(client, PAGE);
    expect(await count('div[role="listitem"]')).toBe(3);

    await installDocument(
      client,
      '<!doctype html><html><head></head><body><section id="second"></section></body></html>',
    );

    expect(await count("#second")).toBe(1);
    expect(await count('div[role="listitem"]')).toBe(0);
  });

  it("creates document.body when resetting to the empty document (#866)", async () => {
    await installDocument(client, EMPTY_DOCUMENT_HTML);

    expect(
      await client.evaluate<boolean>("document.body instanceof HTMLBodyElement"),
    ).toBe(true);
    expect(await client.evaluate<number>("document.body.children.length")).toBe(0);
    expect(await client.evaluate<string>("document.compatMode")).toBe("CSS1Compat");
  });

  it("throws rather than returning when the markup swallows the marker", async () => {
    // The documented bound, exercised rather than asserted in prose: markup
    // ending inside an unterminated comment absorbs whatever follows it, so
    // the marker never reaches the DOM.  Failing loudly on that is the whole
    // point — the behaviour this replaces returned a document nobody had
    // confirmed, and the assertions then read 0 from it.
    // Matched on the message as well as the class: `CDPClient.send` throws
    // `CDPTimeoutError` too, so a mutant that dropped the gate loop and let a
    // request timeout escape would satisfy a type-only assertion — and this is
    // the one test in this tier with power over the loop existing at all.
    // Deliberately bulky, and with a counted number of children: the probe's
    // readings only discriminate against a scale.  A body of one paragraph is
    // barely longer than `about:blank`'s own shell, so `documentLength > 0`
    // would be satisfied by exactly the blank page the reading is supposed to
    // rule out.
    const filler = "<p>x</p>".repeat(40);
    const failure = await installDocument(
      client,
      `<!doctype html><html><body>${filler}<!-- `,
      { timeout: 500 },
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CDPTimeoutError);
    expect((failure as Error).message).toMatch(/sentinel .* never matched/);
    // Every attempt is named, so the log distinguishes "the gate is broken"
    // from "this markup can never satisfy it" without a rerun.
    expect((failure as Error).message).toMatch(/attempt 1: /);
    expect((failure as Error).message).toMatch(/attempt 3: /);
    // ...and the probe is a real reading off a real page, not a placeholder:
    // the unterminated comment swallowed the marker, so the document is there
    // and carries no sentinel.  That is the pair of numbers the next windows
    // failure has to be read against.
    const probe = /page state at giving up: (.*)$/s.exec(
      (failure as Error).message,
    )?.[1];
    const reading = JSON.parse(String(probe)) as {
      url: string;
      readyState: string;
      documentLength: number;
      bodyChildren: number;
      sentinels: number;
    };
    expect(reading).toMatchObject({
      url: "about:blank",
      readyState: "complete",
      bodyChildren: 40,
      sentinels: 0,
    });
    // Against the installed markup's own scale, not against zero.  `40` and
    // `> 300` together say "the caller's document is present and carries no
    // marker" -- which a blank page, whose body is empty and whose shell is
    // 39 characters, cannot satisfy.  That is the discrimination the
    // probe exists to make.
    expect(reading.documentLength).toBeGreaterThan(300);
  }, 15_000);

  it("leaves the page installable again after exhausting its attempts", async () => {
    // The retry navigates the frame to `about:blank`, which is a heavier move
    // than anything this helper did before.  A failed install must not wedge
    // the client for the tests that follow it -- in `fixture-oracle` and
    // `search-results` the next install is the next test, sharing the page.
    await installDocument(client, "<!doctype html><html><body><!-- ", {
      timeout: 200,
    }).catch(() => undefined);

    await installDocument(client, PAGE);

    expect(await count('div[role="listitem"]')).toBe(3);
  }, 15_000);
});
