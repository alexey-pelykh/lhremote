// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Oracle for feed author-field co-location.
 *
 * Two issue numbers appear here and they are not interchangeable: **#825** is
 * the reported bug — `authorName` and `authorProfileUrl` disagree on ~50% of
 * posts — and **#837** is the fix task raised against it, which this file was
 * authored for.  The work closes #825; #837 tracks the change itself.
 *
 * It is authored ahead of the implementation and frozen while that
 * implementation is written, so a passing run is evidence about the script
 * rather than about a test edited to agree with it.  Widening the document
 * double, or adding a fixture for a shape it does not yet cover, is a separate
 * and legitimate change — the rule is that it must not be edited to make a
 * failing implementation pass.
 *
 * ## Why this file exists
 *
 * `SCRAPE_FEED_POSTS_SCRIPT` is a string evaluated inside the LinkedIn page
 * via `Runtime.evaluate`.  Every other test of `get-feed` mocks
 * `client.evaluate` wholesale, so the script's own logic — which element each
 * author field is read from — has never been exercised by anything.  That is
 * exactly the surface #825 measured as wrong on ~50% of posts, so it needs an
 * oracle that actually *runs* the script.
 *
 * The repository has no DOM library and this file deliberately does not add
 * one: it hand-rolls the smallest document double the script needs, in the
 * same spirit as `linkedin/dom-variant.test.ts`, which drives generated
 * in-page sources through `new Function("document", ...)` against a fake page.
 *
 * ## What it asserts
 *
 * One invariant, stated three ways: **`authorName` and `authorProfileUrl` are
 * read from a single anchor element**, so they cannot describe two different
 * people.  The assertions are written against the *observable pair*, never
 * against a mechanism, so any single-anchor implementation satisfies them and
 * no two-source implementation can.
 *
 * `CANARY` is the instrument check.  It passes before and after the fix; a run
 * where it fails means the document double is broken and the other verdicts
 * carry no information about the script (CLAUDE.md § Key Cognitive Triggers →
 * "Degenerate subject gate", broken-instrument corollary).
 */

import { describe, expect, it } from "vitest";
import { SCRAPE_FEED_SCRIPT } from "./get-feed.js";

// ---------------------------------------------------------------------------
// Minimal document double
// ---------------------------------------------------------------------------

/** Attribute selector forms the feed script actually uses. */
type AttrOp = "=" | "^=" | "*=";

interface SimpleSelector {
  readonly tag: string | null;
  readonly attrs: readonly { name: string; op: AttrOp | null; value: string }[];
}

/**
 * Parse one comma-free selector: an optional tag name followed by any number
 * of `[attr]`, `[attr="v"]`, `[attr^="v"]`, `[attr*="v"]` clauses.  Anything
 * richer than that is not used by the feed script and is rejected loudly
 * rather than silently mismatched — a selector the double mis-parses is a
 * broken instrument, not a failing subject.
 */
function parseSimple(selector: string): SimpleSelector {
  const trimmed = selector.trim();
  const tagMatch = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(trimmed);
  const tag = tagMatch ? tagMatch[0].toLowerCase() : null;
  let rest = trimmed.slice(tagMatch ? tagMatch[0].length : 0);

  const attrs: { name: string; op: AttrOp | null; value: string }[] = [];
  while (rest.length > 0) {
    const clause = /^\[([a-zA-Z-]+)(?:(\^=|\*=|=)"([^"]*)")?\]/.exec(rest);
    if (!clause) {
      throw new Error(`unsupported selector fragment: ${JSON.stringify(rest)}`);
    }
    attrs.push({
      name: clause[1] as string,
      op: (clause[2] as AttrOp | undefined) ?? null,
      value: clause[3] ?? "",
    });
    rest = rest.slice(clause[0].length);
  }
  return { tag, attrs };
}

/** Split a selector list on top-level commas. */
function parseSelectorList(selector: string): SimpleSelector[] {
  return selector
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map(parseSimple);
}

let nextNodeId = 0;

class FakeElement {
  readonly tag: string;
  readonly attrs: Record<string, string>;
  readonly children: FakeElement[];
  readonly ownText: string;
  offsetHeight: number;
  parent: FakeElement | null = null;
  readonly nodeId: number;

  constructor(
    tag: string,
    attrs: Record<string, string> = {},
    children: FakeElement[] = [],
    ownText = "",
    offsetHeight = 0,
  ) {
    this.tag = tag.toLowerCase();
    this.attrs = { ...attrs };
    this.children = children;
    this.ownText = ownText;
    this.offsetHeight = offsetHeight;
    this.nodeId = nextNodeId++;
    for (const child of children) child.parent = this;
  }

  get textContent(): string {
    return this.ownText + this.children.map((c) => c.textContent).join("");
  }

  /** `HTMLAnchorElement.href` is the RESOLVED absolute URL, not the attribute. */
  get href(): string {
    const raw = this.attrs["href"];
    if (raw === undefined) return "";
    if (/^https?:\/\//.test(raw)) return raw;
    return `https://www.linkedin.com${raw}`;
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attrs[name] !== undefined;
  }

  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }

  private matches(sel: SimpleSelector): boolean {
    if (sel.tag !== null && sel.tag !== this.tag) return false;
    return sel.attrs.every(({ name, op, value }) => {
      // `href` is matched against the RESOLVED value, mirroring how a browser
      // treats `a[href*="/in/"]` on `<a href="/in/x/">`.
      const actual = name === "href" && this.tag === "a" ? this.href : this.attrs[name];
      if (actual === undefined) return false;
      if (op === null) return true;
      if (op === "=") return actual === value;
      if (op === "^=") return actual.startsWith(value);
      return actual.includes(value);
    });
  }

  private matchesList(selector: string): boolean {
    return parseSelectorList(selector).some((sel) => this.matches(sel));
  }

  private descendants(): FakeElement[] {
    const out: FakeElement[] = [];
    for (const child of this.children) {
      out.push(child, ...child.descendants());
    }
    return out;
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.descendants().filter((el) => el.matchesList(selector));
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  /**
   * `Node.contains` — true for descendants AND for the node itself, which is
   * what the real DOM returns.  The scrape script uses it to drop an
   * `aria-hidden` wrapper nested inside another one, so a double without it
   * throws on any anchor carrying two of them.
   */
  contains(other: FakeElement | null): boolean {
    for (let node = other; node !== null; node = node.parent) {
      if (node === this) return true;
    }
    return false;
  }

  closest(selector: string): FakeElement | null {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let node: FakeElement | null = this;
    while (node !== null) {
      if (node.matchesList(selector)) return node;
      node = node.parent;
    }
    return null;
  }

  cloneNode(deep: boolean): FakeElement {
    return new FakeElement(
      this.tag,
      this.attrs,
      deep ? this.children.map((c) => c.cloneNode(true)) : [],
      this.ownText,
      this.offsetHeight,
    );
  }

  remove(): void {
    if (this.parent === null) return;
    const idx = this.parent.children.indexOf(this);
    if (idx >= 0) this.parent.children.splice(idx, 1);
    this.parent = null;
  }
}

function el(
  tag: string,
  attrs: Record<string, string> = {},
  children: FakeElement[] = [],
  ownText = "",
  offsetHeight = 0,
): FakeElement {
  return new FakeElement(tag, attrs, children, ownText, offsetHeight);
}

function text(tag: string, value: string, attrs: Record<string, string> = {}): FakeElement {
  return new FakeElement(tag, attrs, [], value);
}

/**
 * One post whose author anchor renders LinkedIn's accessible actor-link shape:
 * every field is a pair of a screen-reader-only copy and a visible copy wrapped
 * in `aria-hidden="true"`, so assistive technology reads each field exactly
 * once.  The name's two copies say DIFFERENT things — "View <name>'s profile"
 * against the bare name — and the screen-reader copy is rendered FIRST, so a
 * read that takes the anchor's first run returns the wrong string.
 *
 * The shape also puts four `aria-hidden` wrappers inside one anchor, which is
 * what exercises the nested-wrapper check.
 */
function a11yPostItem(slug: string, name: string): FakeElement {
  const field = (srCopy: string, visible: FakeElement): FakeElement =>
    el("span", {}, [
      text("span", srCopy, { class: "visually-hidden" }),
      el("span", { "aria-hidden": "true" }, [visible]),
    ]);

  return el("div", { role: "listitem" }, [
    el("a", { href: `/in/${slug}/` }, [
      field(`View ${name}'s profile`, text("span", name, { dir: "ltr" })),
      field("2nd degree connection", text("span", "• 2nd")),
      field("Head of Widgets at Acme", text("span", "Head of Widgets at Acme")),
      field("18 hours ago", text("span", "18h •")),
    ]),
    el("div", { "data-testid": "expandable-text-box" }, [
      text("span", "Post body text that is long enough to be real."),
    ]),
    text("button", "", { "aria-label": `${MENU_LABEL_PREFIX}${name}` }),
  ], "", 400);
}

/** The `document` the script is handed: a root element plus `querySelector`. */
function makeDocument(root: FakeElement): unknown {
  return {
    querySelector: (sel: string) => root.querySelector(sel),
    querySelectorAll: (sel: string) => root.querySelectorAll(sel),
    body: root,
  };
}

interface ScrapedPost {
  readonly authorName: string | null;
  readonly authorHeadline: string | null;
  readonly authorProfileUrl: string | null;
  readonly text: string | null;
  readonly timestamp: string | null;
}

function runScrape(root: FakeElement): ScrapedPost[] {
  const window: Record<string, unknown> = {};
  const fn = new Function(
    "document",
    "window",
    `return ${SCRAPE_FEED_SCRIPT};`,
  ) as (document: unknown, window: unknown) => ScrapedPost[];
  return fn(makeDocument(root), window);
}

// ---------------------------------------------------------------------------
// Feed fixtures
// ---------------------------------------------------------------------------

const MENU_LABEL_PREFIX = "Open control menu for post by ";

interface PostShape {
  /** Profile slug the AUTHOR block links to. */
  readonly authorSlug: string;
  /** Visible author name, carried on the author block anchor. */
  readonly authorName: string;
  /** Name the three-dot menu's aria-label claims — the second, drifting source. */
  readonly menuName: string;
  /** An unrelated profile anchor rendered BEFORE the author block, if any. */
  readonly decoy?: { slug: string; name: string } | undefined;
  /**
   * Link the author ONCE (name block only, no avatar anchor).
   *
   * LinkedIn does not always render the avatar as a second anchor to the same
   * profile, and an implementation that identifies the author by "the profile
   * this item links more than once" silently degrades to "the first profile
   * link with text" here — which is the decoy.
   */
  readonly authorLinkedOnce?: boolean | undefined;
  /** Render the visible name in `span[dir="ltr"]` (legacy shape) instead of `<p>`. */
  readonly legacyNameShape?: boolean | undefined;
}

/**
 * One `div[role="listitem"]` in the shape the live feed serves.
 *
 * Structure mirrors the DOM the script documents: an avatar-only anchor to the
 * author, then a text-bearing anchor to the same profile carrying the
 * `[name, degree, headline, timestamp]` run, then the post body, then the
 * three-dot control-menu button.
 */
function postItem(shape: PostShape): FakeElement {
  const href = `/in/${shape.authorSlug}/`;

  const nameNodes = shape.legacyNameShape === true
    ? [
        text("span", shape.authorName, { dir: "ltr" }),
        text("span", "• 1st", { dir: "ltr" }),
        text("span", "Head of Widgets at Acme", { dir: "ltr" }),
        text("span", "18h •", { dir: "ltr" }),
      ]
    : [
        text("p", shape.authorName),
        text("p", "• 1st"),
        text("p", "Head of Widgets at Acme"),
        text("p", "18h •"),
      ];

  const children: FakeElement[] = [];

  if (shape.decoy !== undefined) {
    // A profile anchor that is NOT the author — a mention, a "reposted by"
    // header, a suggested-connection chip.  Rendered first, so a scraper that
    // takes "the first /in/ link in the listitem" picks the wrong person.
    children.push(
      text("a", shape.decoy.name, { href: `/in/${shape.decoy.slug}/` }),
    );
  }

  if (shape.authorLinkedOnce !== true) {
    // Avatar-only author anchor: same profile, no text.
    children.push(el("a", { href }, [el("figure", {}, [])]));
  }

  children.push(
    // Text-bearing author anchor: the author block.  It is the only anchor
    // carrying the `[name, connection degree, headline, relative time]` run.
    el("a", { href }, nameNodes),
    el("div", { "data-testid": "expandable-text-box" }, [
      text("span", "Post body text that is long enough to be real."),
      text("button", "…more", { "data-testid": "expandable-text-button" }),
    ]),
    text("button", "", {
      "aria-label": `${MENU_LABEL_PREFIX}${shape.menuName}`,
    }),
  );

  return el("div", { role: "listitem" }, children, "", 400);
}

function feed(...shapes: PostShape[]): FakeElement {
  return feedOf(...shapes.map(postItem));
}

/** The same feed root, for fixtures built as list items rather than shapes. */
function feedOf(...items: FakeElement[]): FakeElement {
  return el("div", {}, [
    el("div", { "data-testid": "mainFeed", role: "list" }, items),
  ]);
}

/**
 * Every anchor in the listitem, as the `(resolved href, own visible name)`
 * pair a reader would attribute to it.  The co-location assertion below is
 * written against this rather than against any selector the implementation
 * happens to use.
 */
function anchorPairs(item: FakeElement): { url: string; name: string }[] {
  return item.querySelectorAll("a").map((a) => ({
    url: a.href.split("?")[0] as string,
    // The visible name is the anchor's first non-empty text leaf — the same
    // thing a human reads off the author block.
    name: (a.querySelectorAll("p").concat(a.querySelectorAll("span"))
      .map((n) => n.textContent.trim())
      .find((t) => t.length > 0) ?? a.textContent.trim()),
  }));
}

// ---------------------------------------------------------------------------
// Oracle
// ---------------------------------------------------------------------------

describe("get-feed author fields are co-located on one anchor (#837, closes #825)", () => {
  it("CANARY: the document double drives the scrape script end to end", () => {
    const root = feed({
      authorSlug: "consistent-person",
      authorName: "Consistent Person",
      menuName: "Consistent Person",
    });

    const posts = runScrape(root);

    // If this block fails, the instrument is broken and every verdict below is
    // uninformative — fix the double before reading them as findings.
    expect(posts).toHaveLength(1);
    expect(posts[0]?.text).toBe("Post body text that is long enough to be real.");
    expect(posts[0]?.authorName).toBe("Consistent Person");
    expect(posts[0]?.authorProfileUrl).toBe(
      "https://www.linkedin.com/in/consistent-person/",
    );
  });

  it("AC-1: authorProfileUrl resolves to the person named by authorName, with a decoy anchor present", () => {
    const root = feed({
      authorSlug: "real-author",
      authorName: "Real Author",
      menuName: "Real Author",
      decoy: { slug: "mentioned-person", name: "Mentioned Person" },
    });

    const post = runScrape(root)[0];

    expect(post?.authorName).toBe("Real Author");
    expect(post?.authorProfileUrl).toBe(
      "https://www.linkedin.com/in/real-author/",
    );
  });

  it("AC-1: the name comes from the author anchor, not from a drifting control-menu label", () => {
    const root = feed({
      authorSlug: "real-author",
      authorName: "Real Author",
      // The three-dot menu label is the second source #825 measured drifting.
      menuName: "Somebody Else Entirely",
    });

    const post = runScrape(root)[0];

    expect(post?.authorName).toBe("Real Author");
    expect(post?.authorProfileUrl).toBe(
      "https://www.linkedin.com/in/real-author/",
    );
  });

  it("AC-2: both fields are read from ONE anchor element", () => {
    const root = feed({
      authorSlug: "real-author",
      authorName: "Real Author",
      menuName: "Somebody Else Entirely",
      decoy: { slug: "mentioned-person", name: "Mentioned Person" },
    });

    const item = root.querySelector('div[role="listitem"]') as FakeElement;
    const post = runScrape(root)[0];

    // Mechanism-free statement of the invariant: the returned pair must be
    // exactly one anchor's own (href, visible name).  A two-source
    // implementation can satisfy either half, never a single anchor's both.
    const pairs = anchorPairs(item);
    expect(pairs).toContainEqual({
      url: post?.authorProfileUrl,
      name: post?.authorName,
    });
  });

  it("AC-3: holds when the anchor renders its name in the legacy span[dir=\"ltr\"] shape", () => {
    const root = feed({
      authorSlug: "legacy-author",
      authorName: "Legacy Author",
      menuName: "Somebody Else Entirely",
      decoy: { slug: "mentioned-person", name: "Mentioned Person" },
      legacyNameShape: true,
    });

    const item = root.querySelector('div[role="listitem"]') as FakeElement;
    const post = runScrape(root)[0];

    expect(post?.authorName).toBe("Legacy Author");
    expect(post?.authorProfileUrl).toBe(
      "https://www.linkedin.com/in/legacy-author/",
    );
    expect(anchorPairs(item)).toContainEqual({
      url: post?.authorProfileUrl,
      name: post?.authorName,
    });
  });

  it("AC-1: every post in a multi-post feed keeps its own pair co-located", () => {
    const root = feed(
      {
        authorSlug: "first-author",
        authorName: "First Author",
        menuName: "Somebody Else Entirely",
        decoy: { slug: "mentioned-person", name: "Mentioned Person" },
      },
      {
        authorSlug: "second-author",
        authorName: "Second Author",
        menuName: "Another Wrong Name",
      },
    );

    const items = root.querySelectorAll('div[role="listitem"]');
    const posts = runScrape(root);

    expect(posts).toHaveLength(2);
    posts.forEach((post, idx) => {
      expect(anchorPairs(items[idx] as FakeElement)).toContainEqual({
        url: post.authorProfileUrl,
        name: post.authorName,
      });
    });
    expect(posts[0]?.authorName).toBe("First Author");
    expect(posts[1]?.authorName).toBe("Second Author");
  });
  /**
   * The three cases below were found by an independent verification pass and
   * added here afterwards.  They do not widen the requirement: issue #837 asks
   * for both fields to come from "the same **author** element", and a pair
   * drawn consistently from the *wrong* person satisfies co-location while
   * failing the thing co-location exists to deliver.  The cases above cannot
   * catch that — in every one of them the author is linked twice, so any rule
   * keyed on link multiplicity passes them.  These link the author ONCE.
   *
   * The author block stays distinguishable by something every dialect shares:
   * it is the only profile anchor whose own text carries the connection-degree
   * and relative-time run.  A chip, a mention and a suggested-connection link
   * carry a bare name and nothing else.
   */
  it("AC-1 (identity): a suggested-connection anchor before a singly-linked author is not the author", () => {
    const root = feed({
      authorSlug: "only-author",
      authorName: "Only Author",
      menuName: "Only Author",
      decoy: { slug: "suggested-connection", name: "Suggested Connection" },
      authorLinkedOnce: true,
    });

    const post = runScrape(root)[0];

    expect(post?.authorName).toBe("Only Author");
    expect(post?.authorProfileUrl).toBe(
      "https://www.linkedin.com/in/only-author/",
    );
  });

  it("AC-1 (identity): a repost chip before a singly-linked author is not the author", () => {
    const root = feed({
      authorSlug: "real-author",
      authorName: "Real Author",
      menuName: "Real Author",
      decoy: { slug: "resharer-person", name: "Resharer Person" },
      authorLinkedOnce: true,
    });

    const item = root.querySelector('div[role="listitem"]') as FakeElement;
    const post = runScrape(root)[0];

    expect(post?.authorName).toBe("Real Author");
    expect(post?.authorProfileUrl).toBe(
      "https://www.linkedin.com/in/real-author/",
    );
    // Still co-located, not merely correct.
    expect(anchorPairs(item)).toContainEqual({
      url: post?.authorProfileUrl,
      name: post?.authorName,
    });
  });

  it("AC-3 (identity): the same holds for a singly-linked author in the legacy span shape", () => {
    const root = feed({
      authorSlug: "legacy-author",
      authorName: "Legacy Author",
      menuName: "Legacy Author",
      decoy: { slug: "resharer-person", name: "Resharer Person" },
      authorLinkedOnce: true,
      legacyNameShape: true,
    });

    const post = runScrape(root)[0];

    expect(post?.authorName).toBe("Legacy Author");
    expect(post?.authorProfileUrl).toBe(
      "https://www.linkedin.com/in/legacy-author/",
    );
  });

  it("AC-1 (a11y): the name is the visible copy, not the screen-reader copy rendered before it", () => {
    const root = feedOf(a11yPostItem("ada-lovelace", "Ada Lovelace"));

    const item = root.querySelector('div[role="listitem"]') as FakeElement;
    const post = runScrape(root)[0];

    // The anchor's first run is "View Ada Lovelace's profile"; the name is the
    // aria-hidden copy that follows it.
    expect(post?.authorName).toBe("Ada Lovelace");
    expect(post?.authorProfileUrl).toBe(
      "https://www.linkedin.com/in/ada-lovelace/",
    );

    // Co-location, stated for a shape `anchorPairs` cannot model: it reads an
    // anchor's first text leaf, which is the screen-reader copy here, so it
    // would have to be taught the visible-copy rule to be used — and a helper
    // that mirrors the implementation stops being independent evidence.  The
    // item renders exactly ONE anchor, so both fields necessarily came from it.
    const anchors = item.querySelectorAll("a");
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.href).toBe(post?.authorProfileUrl);
    expect(anchors[0]?.textContent).toContain(post?.authorName ?? "");
  });

  it("AC-1 (a11y): a neighbouring field is not swallowed into the name, nor returned as it", () => {
    const root = feedOf(a11yPostItem("ada-lovelace", "Ada Lovelace"));

    const name = runScrape(root)[0]?.authorName ?? "";

    // The same anchor carries the connection degree, the headline and the
    // timestamp, each in its own aria-hidden wrapper.  None of them belongs in
    // the name, whether appended to it or returned in its place.
    expect(name).toBe("Ada Lovelace");
    expect(name).not.toContain("2nd");
    expect(name).not.toContain("18h");
    expect(name).not.toContain("Head of Widgets");
  });

  it("AC-3: the name is the run rendered first, whichever tag carries it", () => {
    // An anchor mixing both run shapes: the name in a legacy `<span>`, a later
    // field in an SDUI `<p>`.  Collecting `<p>` and `<span>` as two queries
    // orders every `<p>` ahead of every `<span>`, so the headline would outrank
    // a name rendered before it; document order is what decides.
    const root = feedOf(
      el("div", { role: "listitem" }, [
        el("a", { href: "/in/mixed-order/" }, [
          text("span", "Real Name", { dir: "ltr" }),
          text("p", "Head of Widgets at Acme"),
        ]),
        el("div", { "data-testid": "expandable-text-box" }, [
          text("span", "Post body text that is long enough to be real."),
        ]),
        text("button", "", { "aria-label": `${MENU_LABEL_PREFIX}Real Name` }),
      ], "", 400),
    );

    const post = runScrape(root)[0];

    expect(post?.authorName).toBe("Real Name");
    expect(post?.authorProfileUrl).toBe(
      "https://www.linkedin.com/in/mixed-order/",
    );
  });

  it("AC-2 (a11y): a decoration-only wrapper never becomes the name", () => {
    const root = feedOf(
      el("div", { role: "listitem" }, [
        el("a", { href: "/in/gus-glyph/" }, [
          el("span", { "aria-hidden": "true" }, [text("span", "•")]),
          text("span", "Gus Glyph", { dir: "ltr" }),
        ]),
        el("div", { "data-testid": "expandable-text-box" }, [
          text("span", "Post body text that is long enough to be real."),
        ]),
        text("button", "", { "aria-label": `${MENU_LABEL_PREFIX}Gus Glyph` }),
      ], "", 400),
    );

    const post = runScrape(root)[0];

    expect(post?.authorName).toBe("Gus Glyph");
    expect(post?.authorProfileUrl).toBe(
      "https://www.linkedin.com/in/gus-glyph/",
    );
  });
});

// ---------------------------------------------------------------------------
// #859 fixtures — the decoy renders the way the author does
// ---------------------------------------------------------------------------

/**
 * Every shape above leaves the author block separable by a property the decoy
 * lacks: the `[name, degree, headline, relative time]` run, a second anchor to
 * the same profile, or a name run where the chip is bare text.  Issue #859 is
 * the remainder — the post where the decoy renders EXACTLY the way the author
 * does, so nothing about an anchor's own href and text tells them apart.
 *
 * The author anchor in these fixtures therefore carries its name run and
 * nothing else: no connection degree, no headline, no relative-time token.
 * That is not a simplification of the live DOM, it IS the reproduction — on
 * these posts LinkedIn renders the timestamp outside the actor anchor, and an
 * author anchor that did carry the time run would be picked correctly by the
 * first signal, which is exactly why the shapes above pass.
 */

/** The tag a name run is rendered in: `<p>` in the SDUI shape, `<span>` in the legacy one. */
type RunTag = "p" | "span";

function nameRun(tag: RunTag, value: string): FakeElement {
  return tag === "span" ? text("span", value, { dir: "ltr" }) : text("p", value);
}

interface DecoyAnchorShape {
  /** Profile path the chip links to, e.g. `/in/resharer-person/`. */
  readonly href: string;
  readonly name: string;
  /**
   * Render the chip's name inside a run, the way the actor block does.  Left
   * undefined, the chip renders its name as bare anchor text — the shape the
   * fixtures above use, which today's third signal already separates.
   */
  readonly runTag?: RunTag | undefined;
}

interface ActorHeaderShape {
  /** Profile path the AUTHOR block links to — `/in/…/` or `/company/…/`. */
  readonly authorHref: string;
  readonly authorName: string;
  readonly authorRunTag: RunTag;
  /** An unrelated profile anchor rendered BEFORE the author block. */
  readonly decoy?: DecoyAnchorShape | undefined;
  /** Link the author twice: an avatar-only anchor, then the name block. */
  readonly withAvatar?: boolean | undefined;
  /** A profile anchor rendered INSIDE the post body — a mention. */
  readonly mention?: { readonly href: string; readonly name: string } | undefined;
  /**
   * A profile anchor rendered BETWEEN the two markers that close the actor
   * header — after the first of them, before the second.  Only the marker that
   * comes FIRST bounds the region, so this anchor is outside it either way; a
   * region bounded on just one of the two markers admits it.
   */
  readonly betweenMarkers?: { readonly href: string; readonly name: string } | undefined;
  /** Render the control-menu button BEFORE the post body rather than after it. */
  readonly menuBeforeBody?: boolean | undefined;
  /** Name the control-menu label claims; defaults to the author's own. */
  readonly menuName?: string | undefined;
}

/**
 * One `div[role="listitem"]` whose actor header is built to order.
 *
 * Deliberately a second builder rather than more flags on `postItem`: that one
 * is referenced by every fixture above and its author anchor always carries the
 * full field run, which is the property these shapes must not have.
 */
function actorPostItem(shape: ActorHeaderShape): FakeElement {
  const children: FakeElement[] = [];

  if (shape.decoy !== undefined) {
    const decoy = shape.decoy;
    children.push(
      decoy.runTag === undefined
        ? text("a", decoy.name, { href: decoy.href })
        : el("a", { href: decoy.href }, [nameRun(decoy.runTag, decoy.name)]),
    );
  }

  if (shape.withAvatar === true) {
    children.push(el("a", { href: shape.authorHref }, [el("figure", {}, [])]));
  }

  children.push(
    el("a", { href: shape.authorHref }, [
      nameRun(shape.authorRunTag, shape.authorName),
    ]),
  );

  const bodyChildren: FakeElement[] = [
    text("span", "Post body text that is long enough to be real."),
  ];
  if (shape.mention !== undefined) {
    // Rendered as a name RUN, not as bare text: a mention that renders bare
    // already falsifies "the last profile anchor wins", while this one also
    // falsifies "the last anchor rendering a name run wins".  The stronger
    // decoy cannot turn a wrong implementation green.
    bodyChildren.push(
      el("a", { href: shape.mention.href }, [nameRun("span", shape.mention.name)]),
    );
  }

  const body = el("div", { "data-testid": "expandable-text-box" }, bodyChildren);
  const menu = text("button", "", {
    "aria-label": `${MENU_LABEL_PREFIX}${shape.menuName ?? shape.authorName}`,
  });

  const between: FakeElement[] =
    shape.betweenMarkers === undefined
      ? []
      : [
          el("a", { href: shape.betweenMarkers.href }, [
            nameRun("span", shape.betweenMarkers.name),
          ]),
        ];

  children.push(
    ...(shape.menuBeforeBody === true
      ? [menu, ...between, body]
      : [body, ...between, menu]),
  );

  return el("div", { role: "listitem" }, children, "", 400);
}

/** The `(name, url)` pair the script reported for a single-post feed. */
function scrapeOne(item: FakeElement): { name: string | null; url: string | null } {
  const post = runScrape(feedOf(item))[0];
  return { name: post?.authorName ?? null, url: post?.authorProfileUrl ?? null };
}

/** Reproduction 1: repost chip before the author, both names in `span[dir="ltr"]` runs. */
const CHIP_BEFORE_LEGACY_AUTHOR: ActorHeaderShape = {
  authorHref: "/in/real-author/",
  authorName: "Real Author",
  authorRunTag: "span",
  decoy: { href: "/in/resharer-person/", name: "Resharer Person", runTag: "span" },
};

/** Reproduction 2: the chip's name in a `<span>` run, the author's in a `<p>` run. */
const CHIP_SPAN_BEFORE_SDUI_AUTHOR: ActorHeaderShape = {
  authorHref: "/in/genuine-author/",
  authorName: "Genuine Author",
  authorRunTag: "p",
  decoy: { href: "/in/resharer/", name: "Resharer", runTag: "span" },
};

/** Reproduction 3: a decoy whose OWN bare text carries a relative-time token. */
const TIME_TOKEN_DECOY_BEFORE_AUTHOR: ActorHeaderShape = {
  authorHref: "/in/real-author/",
  authorName: "Real Author",
  authorRunTag: "p",
  decoy: { href: "/in/deco-yperson/", name: "Deco Yperson 2d" },
};

/** Reproduction 4: a `/company/` author preceded by an `/in/` repost chip. */
const CHIP_BEFORE_COMPANY_AUTHOR: ActorHeaderShape = {
  authorHref: "/company/acme-corp/",
  authorName: "Acme Corp",
  authorRunTag: "p",
  decoy: { href: "/in/chip-person/", name: "Chip Person", runTag: "span" },
};

const REPRODUCTIONS: readonly {
  readonly ac: string;
  readonly shape: ActorHeaderShape;
  readonly expected: { readonly name: string; readonly url: string };
}[] = [
  {
    ac: "AC-1",
    shape: CHIP_BEFORE_LEGACY_AUTHOR,
    expected: { name: "Real Author", url: "https://www.linkedin.com/in/real-author/" },
  },
  {
    ac: "AC-2",
    shape: CHIP_SPAN_BEFORE_SDUI_AUTHOR,
    expected: { name: "Genuine Author", url: "https://www.linkedin.com/in/genuine-author/" },
  },
  {
    ac: "AC-3",
    shape: TIME_TOKEN_DECOY_BEFORE_AUTHOR,
    expected: { name: "Real Author", url: "https://www.linkedin.com/in/real-author/" },
  },
  {
    ac: "AC-4",
    shape: CHIP_BEFORE_COMPANY_AUTHOR,
    expected: { name: "Acme Corp", url: "https://www.linkedin.com/company/acme-corp/" },
  },
];

// ---------------------------------------------------------------------------
// Oracle — #859
// ---------------------------------------------------------------------------

/**
 * The AC numbering below runs 1-5 then 7-9 with no AC-6.  That is not an
 * omission: #859's AC-6 is "no regression" — every assertion above this block
 * still passing, plus the rest of the package suite — which is discharged by
 * running the suite, not by any one `it` here.
 */
describe("get-feed reports the actor, not a chip rendered before it (#859)", () => {
  it("#859 AC-1: a repost chip whose name renders in the same span[dir=\"ltr\"] run as the author's is not the author", () => {
    expect(scrapeOne(actorPostItem(CHIP_BEFORE_LEGACY_AUTHOR))).toEqual({
      name: "Real Author",
      url: "https://www.linkedin.com/in/real-author/",
    });
  });

  it("#859 AC-2: a repost chip in a <span> run before an author in <p> runs is not the author", () => {
    expect(scrapeOne(actorPostItem(CHIP_SPAN_BEFORE_SDUI_AUTHOR))).toEqual({
      name: "Genuine Author",
      url: "https://www.linkedin.com/in/genuine-author/",
    });
  });

  it("#859 AC-3: a decoy whose own text carries a relative-time token is not the author", () => {
    // Defeats the first signal specifically: the decoy's bare text ends in
    // "2d", so the rule "the anchor whose text carries the time run" selects
    // it, and the author's anchor carries no time token to outrank it with.
    expect(scrapeOne(actorPostItem(TIME_TOKEN_DECOY_BEFORE_AUTHOR))).toEqual({
      name: "Real Author",
      url: "https://www.linkedin.com/in/real-author/",
    });
  });

  it("#859 AC-4: a /company/ author preceded by an /in/ chip keeps BOTH fields, not just the name", () => {
    // The reported URL flips host path space here — /company/ to /in/ — so a
    // fix that repaired only the name would still misattribute the post.
    expect(scrapeOne(actorPostItem(CHIP_BEFORE_COMPANY_AUTHOR))).toEqual({
      name: "Acme Corp",
      url: "https://www.linkedin.com/company/acme-corp/",
    });
  });

  it("#859 AC-5: in every reproduction the returned pair is one anchor's own pair", () => {
    // Mechanism-free, in the style of the anchorPairs assertion above: whatever
    // rule selects the anchor, the two fields must still come off ONE element,
    // so #825's invariant cannot be traded away to fix #859.
    for (const { ac, shape, expected } of REPRODUCTIONS) {
      const item = actorPostItem(shape);
      const scraped = scrapeOne(item);

      expect(anchorPairs(item), ac).toContainEqual({
        url: scraped.url,
        name: scraped.name,
      });
      expect(scraped, ac).toEqual(expected);
    }
  });

  /**
   * AC-7 is the falsifier for the cheap fix, so it is built to leave the actor
   * header region as the ONLY thing that can answer it.  Every other signal is
   * deliberately disarmed:
   *
   * - the author is linked ONCE, so "the profile linked twice" cannot rescue it
   *   — an avatar anchor would make that signal fire and the assertion vacuous;
   * - the mention renders its name in a RUN, so "the anchor wrapping its name in
   *   a run" cannot rescue it either;
   * - the mention is the LAST profile anchor in the listitem, so a rule that
   *   simply reverses the cascade's direction reports the mention.
   *
   * With all three disarmed, only knowing WHERE the anchor sits gets this right.
   * Verified by mutation: removing the region bound turns both cases red.
   */
  it("#859 AC-7 (a): a mention in the post body is not the author, menu button before the body", () => {
    // [chip, nameBlock, menuButton, textBox(mention)].
    expect(
      scrapeOne(
        actorPostItem({
          authorHref: "/in/real-author/",
          authorName: "Real Author",
          authorRunTag: "p",
          decoy: { href: "/in/resharer-person/", name: "Resharer Person", runTag: "span" },
          menuBeforeBody: true,
          mention: { href: "/in/mentioned-person/", name: "Mentioned Person" },
        }),
      ),
    ).toEqual({ name: "Real Author", url: "https://www.linkedin.com/in/real-author/" });
  });

  it("#859 AC-7 (b): a mention in the post body is not the author, body before the menu button", () => {
    // [chip, nameBlock, textBox(mention), menuButton].  The existing fixtures
    // render the body first and the live DOM has been observed both ways, so a
    // region bounded on only one of the two markers passes one of these
    // orderings and fails the other.
    expect(
      scrapeOne(
        actorPostItem({
          authorHref: "/in/real-author/",
          authorName: "Real Author",
          authorRunTag: "p",
          decoy: { href: "/in/resharer-person/", name: "Resharer Person", runTag: "span" },
          mention: { href: "/in/mentioned-person/", name: "Mentioned Person" },
        }),
      ),
    ).toEqual({ name: "Real Author", url: "https://www.linkedin.com/in/real-author/" });
  });

  it("#859 AC-7 (c): a resharer who is ALSO mentioned in the post body is still not the author", () => {
    // The chip and the body mention are the SAME profile, so that profile is
    // linked twice while the author is linked once.  Any rule that scores link
    // multiplicity across the WHOLE post — rather than within the region it is
    // ranking anchors in — reads the chip as "the profile linked twice, i.e.
    // the avatar + name block pair" and returns the resharer.  The two anchors
    // that pairing signal exists to recognise are both inside the actor header,
    // so the region is the only corpus it may count over.
    expect(
      scrapeOne(
        actorPostItem({
          authorHref: "/in/real-author/",
          authorName: "Real Author",
          authorRunTag: "p",
          decoy: { href: "/in/resharer-person/", name: "Resharer Person", runTag: "span" },
          mention: { href: "/in/resharer-person/", name: "Resharer Person" },
        }),
      ),
    ).toEqual({ name: "Real Author", url: "https://www.linkedin.com/in/real-author/" });
  });

  it("#859 AC-7 (d): the actor header closes at whichever marker comes FIRST", () => {
    // [chip, nameBlock, menuButton, strayAnchor, textBox].  The stray anchor
    // sits BETWEEN the two markers, so it is outside the header under a bound
    // that closes on the menu button and inside it under a bound that closes
    // only on the post body.  Without this shape, dropping the button from the
    // region's marker set is a silent no-op across the whole suite, while the
    // implementation claims taking whichever comes first is what makes the
    // bound hold in both of LinkedIn's orderings.
    expect(
      scrapeOne(
        actorPostItem({
          authorHref: "/in/real-author/",
          authorName: "Real Author",
          authorRunTag: "p",
          decoy: { href: "/in/resharer-person/", name: "Resharer Person", runTag: "span" },
          menuBeforeBody: true,
          betweenMarkers: { href: "/in/stray-person/", name: "Stray Person" },
        }),
      ),
    ).toEqual({ name: "Real Author", url: "https://www.linkedin.com/in/real-author/" });
  });

  it("#859 AC-8: an author anchor rendered after both markers still yields an author, not null", () => {
    // Nothing renders in the actor header at all, so the new signal has
    // nothing to say and today's cascade must still answer.  A region-bounded
    // rule that returns null when its region is empty would blank the author
    // on every shape not enumerated here.
    const item = el(
      "div",
      { role: "listitem" },
      [
        text("button", "", { "aria-label": `${MENU_LABEL_PREFIX}Trailing Author` }),
        el("div", { "data-testid": "expandable-text-box" }, [
          text("span", "Post body text that is long enough to be real."),
        ]),
        el("a", { href: "/in/trailing-author/" }, [
          nameRun("p", "Trailing Author"),
        ]),
      ],
      "",
      400,
    );

    expect(scrapeOne(item)).toEqual({
      name: "Trailing Author",
      url: "https://www.linkedin.com/in/trailing-author/",
    });
  });

  it("#859 AC-9: with an empty actor header the ORIGINAL cascade decides, not merely non-null", () => {
    // AC-8's fixture renders a single anchor, so every branch of the fallback
    // returns the same element and none of them is actually pinned — the
    // fallback would survive being replaced by "the first anchor with text".
    // Two anchors, and the author distinguished only by the relative-time run,
    // is what holds the fallback's own first signal in place: the decoy renders
    // a name run and comes first, so a fallback that lost its time signal
    // returns the decoy.
    //
    // Note this is the ONE region where the time signal is still consulted, and
    // deliberately so: with no actor header there is no positional evidence to
    // replace it.
    const item = el(
      "div",
      { role: "listitem" },
      [
        text("button", "", { "aria-label": `${MENU_LABEL_PREFIX}Fallback Author` }),
        el("div", { "data-testid": "expandable-text-box" }, [
          text("span", "Post body text that is long enough to be real."),
        ]),
        el("a", { href: "/in/late-decoy/" }, [nameRun("span", "Late Decoy")]),
        el("a", { href: "/in/fallback-author/" }, [
          nameRun("p", "Fallback Author"),
          text("p", "18h •"),
        ]),
      ],
      "",
      400,
    );

    expect(scrapeOne(item)).toEqual({
      name: "Fallback Author",
      url: "https://www.linkedin.com/in/fallback-author/",
    });
  });
});

// ---------------------------------------------------------------------------
// #860 / #898 fixtures — field extraction inside the already-selected anchor
// ---------------------------------------------------------------------------

/**
 * Everything below is HAND-BUILT, not captured markup.  The repository holds no
 * captured feed-dialect DOM fixture at all — `linkedin/__fixtures__/` carries
 * two post-detail captures, neither in this dialect — so this surface is graded
 * only against shapes reasoned from the DOM notes in `get-feed.ts`.  A shape
 * LinkedIn serves that nobody here thought of is outside what these verdicts
 * can say anything about, and a green run is not evidence of real-markup
 * coverage.
 *
 * The two issues are one fault seen twice: field extraction from the
 * already-selected author anchor is not dialect-tolerant, where anchor
 * SELECTION (#859, above) now is.
 *
 * **#860 — the name.**  The previous read picked ONE of the anchor's
 * `aria-hidden` wrappers, the first rendering a run, and returned that run.
 * Two families defeat it, and they are the same shape structurally — so no rule
 * reading wrapper membership alone separates them, it can only choose which to
 * serve:
 *
 *   TRUNCATION     the name is SPLIT across wrappers, so one wrapper holds part
 *                  of it and the rest is dropped — `"Ada"` for `"Ada Multi"`.
 *   CONTAMINATION  the name shares its wrapper with another field, or a
 *                  neighbouring field is the only thing rendered as a run — so
 *                  `"2nd"`, `"18h •"` or `"Mathematician"` is returned AS the
 *                  name.
 *
 * **#898 — the headline and the timestamp.**  Both were read off `<p>`
 * elements, so an anchor rendering its fields as `<span>` runs — the legacy
 * dialect — yielded `null` for both, for the whole class.
 */

/** An `aria-hidden` wrapper rendering its text inside a run. */
function hiddenRun(value: string, tag: RunTag = "span"): FakeElement {
  return el("span", { "aria-hidden": "true" }, [nameRun(tag, value)]);
}

/** An `aria-hidden` wrapper whose text is BARE — it renders no run at all. */
function hiddenBare(value: string): FakeElement {
  return el("span", { "aria-hidden": "true" }, [], value);
}

/**
 * One post whose author anchor renders exactly the children it is given.
 *
 * The control-menu label deliberately names someone else: #825 removed it as a
 * name source, and a fix that reached for it again would show up here.
 */
function anchorItem(href: string, children: FakeElement[]): FakeElement {
  return el("div", { role: "listitem" }, [
    el("a", { href }, children),
    el("div", { "data-testid": "expandable-text-box" }, [
      text("span", "Post body text that is long enough to be real."),
    ]),
    text("button", "", { "aria-label": `${MENU_LABEL_PREFIX}Menu Label Person` }),
  ], "", 400);
}

/** The four author fields the script reported for a single-post feed. */
function scrapeAuthor(item: FakeElement): {
  name: string | null;
  headline: string | null;
  url: string | null;
  timestamp: string | null;
} {
  const post = runScrape(feedOf(item))[0];
  return {
    name: post?.authorName ?? null,
    headline: post?.authorHeadline ?? null,
    url: post?.authorProfileUrl ?? null,
    timestamp: post?.timestamp ?? null,
  };
}

/** The four fields an actor anchor renders, in the tag its dialect uses. */
function dialectFields(tag: RunTag, name: string): FakeElement[] {
  return [
    nameRun(tag, name),
    nameRun(tag, "• 1st"),
    nameRun(tag, "Head of Widgets at Acme"),
    nameRun(tag, "18h •"),
  ];
}

interface NameReproduction {
  readonly ac: string;
  readonly label: string;
  readonly href: string;
  readonly children: () => FakeElement[];
  readonly expected: string;
}

const NAME_REPRODUCTIONS: readonly NameReproduction[] = [
  {
    ac: "AC-1",
    label: "a name SPLIT across wrappers is returned whole, not truncated",
    href: "/in/ada-multi/",
    children: () => [hiddenRun("Ada"), hiddenRun("Multi"), hiddenRun("• 1st")],
    expected: "Ada Multi",
  },
  {
    ac: "AC-2",
    label: "a connection degree sharing the name's wrapper is not returned with it",
    href: "/in/ada-lovelace/",
    children: () => [
      hiddenRun("Ada Lovelace · 1st"),
      hiddenRun("Head of Widgets at Acme"),
      hiddenRun("18h •"),
    ],
    expected: "Ada Lovelace",
  },
  {
    ac: "AC-2",
    label: "a badge is not the name when the badge is the anchor's only run",
    href: "/in/ada-lovelace/",
    children: () => [hiddenBare("Ada Lovelace"), hiddenRun("2nd")],
    expected: "Ada Lovelace",
  },
  {
    ac: "AC-2",
    label: "a timestamp is not the name when the timestamp is the anchor's only run",
    href: "/in/ada-lovelace/",
    children: () => [hiddenBare("Ada Lovelace"), hiddenRun("18h •")],
    expected: "Ada Lovelace",
  },
  {
    ac: "AC-2",
    label: "a headline is not the name when the headline is the anchor's only run",
    href: "/in/ada-lovelace/",
    children: () => [hiddenBare("Ada Lovelace"), hiddenRun("Mathematician")],
    expected: "Ada Lovelace",
  },
];

describe("get-feed resolves the name from the author anchor's field sequence (#860)", () => {
  it("CANARY: the wrapper fixtures render the shape they claim, and the script runs on them", () => {
    const item = anchorItem("/in/ada-lovelace/", [
      hiddenBare("Ada Lovelace"),
      hiddenRun("2nd"),
    ]);

    // The instrument, in two parts.  First the FIXTURE: two outermost
    // aria-hidden wrappers, the first rendering no run and the second rendering
    // one.  A builder that nested them, collapsed them, or gave the first a run
    // after all would leave every verdict below vacuous — the
    // badge-is-the-only-run family would simply not be on the page.
    const wrappers = item.querySelectorAll('[aria-hidden="true"]');
    expect(wrappers).toHaveLength(2);
    expect(wrappers[0]?.querySelectorAll("p, span")).toHaveLength(0);
    expect(wrappers[0]?.textContent).toBe("Ada Lovelace");
    expect(wrappers[1]?.querySelectorAll("p, span")).toHaveLength(1);

    // Then the pipeline, on fields this issue does not touch, so the canary
    // reads the same before and after the fix.
    const posts = runScrape(feedOf(item));
    expect(posts).toHaveLength(1);
    expect(posts[0]?.text).toBe("Post body text that is long enough to be real.");
    expect(posts[0]?.authorProfileUrl).toBe(
      "https://www.linkedin.com/in/ada-lovelace/",
    );
  });

  // Each reproduction asserts the one value that is correct for it.  An earlier
  // round paired that with a list of `not.toBe` prohibitions per fixture; they
  // could not fail, because the equality above them already forbids every other
  // string.  AC-2's general claim — a badge, a timestamp or a headline is NEVER
  // the name — is bought instead by the breadth of the corpus at the end of
  // this file, which grades that same claim across every shape in it.
  for (const shape of NAME_REPRODUCTIONS) {
    it(`#860 ${shape.ac}: ${shape.label}`, () => {
      const scraped = scrapeAuthor(anchorItem(shape.href, shape.children()));

      expect(scraped.name).toBe(shape.expected);
      expect(scraped.url).toBe(`https://www.linkedin.com${shape.href}`);
    });
  }

  it("#860 AC-5: a split name resolves under BOTH the legacy <span> and SDUI <p> shapes", () => {
    const split = (tag: RunTag): FakeElement[] => [
      nameRun(tag, "Ada"),
      nameRun(tag, "Multi"),
      nameRun(tag, "• 1st"),
    ];

    // No aria-hidden wrapper anywhere: the anchor itself is the field root.
    // Keyed on nothing but the href and the anchor's own runs, so neither
    // dialect needs a marker of its own.
    expect(scrapeAuthor(anchorItem("/in/ada-multi/", split("span"))).name)
      .toBe("Ada Multi");
    expect(scrapeAuthor(anchorItem("/in/ada-multi/", split("p"))).name)
      .toBe("Ada Multi");
  });

  it("#860 AC-4: name and profile URL still come from ONE anchor element", () => {
    const item = anchorItem("/in/ada-lovelace/", [
      hiddenBare("Ada Lovelace"),
      hiddenRun("2nd"),
    ]);

    const scraped = scrapeAuthor(item);
    const anchors = item.querySelectorAll("a");

    // The item renders exactly one anchor, so both fields necessarily came from
    // it — the same statement the a11y co-location test above makes, restated
    // for a shape `anchorPairs` cannot model (it reads an anchor's first text
    // leaf, which here is the name's bare wrapper text).
    //
    // The `toContain` is paired with a `toBe` on the name, as its model earlier
    // in this file is.  On its own `toContain` is satisfied by every substring
    // of the anchor's concatenated text — "Ada", "2nd", "e2n", and the empty
    // string when the name is null — so it would pass for precisely the bug it
    // is here to forbid.  The equality is what makes the co-location claim
    // about the RIGHT name.
    expect(anchors).toHaveLength(1);
    expect(scraped.name).toBe("Ada Lovelace");
    expect(anchors[0]?.href).toBe(scraped.url);
    expect(anchors[0]?.textContent).toContain(scraped.name ?? "");
  });

  it("#860: a slug carrying LinkedIn's trailing disambiguation hash still matches the name", () => {
    // `/in/john-smith-4b1f9c2a/` — the hash is why whole-string equality would
    // fail and a shared PREFIX does not.
    //
    // The name is rendered as the wrapper's BARE text while the badge is the
    // anchor's only run, so the fallback would answer "• 2nd".  That matters:
    // with the name rendered as a run instead, the fallback returns "John
    // Smith" as well and this fixture would pass whatever the href-keyed read
    // did — including not existing.  Here only a read that consults the href
    // can produce the expected value.
    const scraped = scrapeAuthor(
      anchorItem("/in/john-smith-4b1f9c2a/", [
        hiddenBare("John Smith"),
        hiddenRun("• 2nd"),
      ]),
    );

    expect(scraped.name).toBe("John Smith");
    expect(scraped.url).toBe("https://www.linkedin.com/in/john-smith-4b1f9c2a/");
  });
});

describe("get-feed reads headline and timestamp from that same sequence (#898)", () => {
  it("CANARY: each dialect fixture renders four fields in its OWN tag only", () => {
    const legacy = anchorItem("/in/legacy-author/", dialectFields("span", "Legacy Author"));
    const sdui = anchorItem("/in/sdui-author/", dialectFields("p", "Sdui Author"));

    // The instrument: the two fixtures must actually differ in tag, or AC-6
    // would be graded against an anchor that is secretly the SDUI shape and
    // would pass without the legacy dialect ever being exercised.
    const legacyAnchor = legacy.querySelectorAll("a")[0];
    const sduiAnchor = sdui.querySelectorAll("a")[0];
    expect(legacyAnchor?.querySelectorAll("span")).toHaveLength(4);
    expect(legacyAnchor?.querySelectorAll("p")).toHaveLength(0);
    expect(sduiAnchor?.querySelectorAll("p")).toHaveLength(4);
    expect(sduiAnchor?.querySelectorAll("span")).toHaveLength(0);

    expect(runScrape(feedOf(legacy))).toHaveLength(1);
    expect(runScrape(feedOf(sdui))).toHaveLength(1);
  });

  it("#898 AC-6: a legacy <span>-run anchor yields BOTH headline and timestamp", () => {
    const scraped = scrapeAuthor(
      anchorItem("/in/legacy-author/", dialectFields("span", "Legacy Author")),
    );

    expect(scraped.headline).toBe("Head of Widgets at Acme");
    expect(scraped.timestamp).toBe("18h");
    expect(scraped.name).toBe("Legacy Author");
    expect(scraped.url).toBe("https://www.linkedin.com/in/legacy-author/");
  });

  it("#898 AC-7: an SDUI <p>-run anchor keeps the answers it already gave", () => {
    const scraped = scrapeAuthor(
      anchorItem("/in/sdui-author/", dialectFields("p", "Sdui Author")),
    );

    expect(scraped.headline).toBe("Head of Widgets at Acme");
    expect(scraped.timestamp).toBe("18h");
    expect(scraped.name).toBe("Sdui Author");
  });

  it("#898 AC-8: an anchor carrying only a name run yields null for both — honestly", () => {
    // The #859 class: LinkedIn renders the timestamp outside the anchor on
    // these posts, so there is no headline and no time field to find.  Null is
    // the truth here, and asserting it is what stops the fix being "populate
    // these fields from somewhere else in the item".
    for (const tag of ["span", "p"] as const) {
      const scraped = scrapeAuthor(
        anchorItem("/in/solo-author/", [nameRun(tag, "Solo Author")]),
      );

      expect(scraped.name).toBe("Solo Author");
      expect(scraped.headline).toBeNull();
      expect(scraped.timestamp).toBeNull();
    }
  });

  it("#898: a headline that legitimately STARTS with an ordinal is not eaten as a degree", () => {
    // "1st Officer at Acme" opens with an ordinal and also with a `\d+[smhdw]`
    // token ("1s"), so both the degree rule and the timestamp rule have to be
    // anchored at BOTH ends to leave it alone.
    const scraped = scrapeAuthor(
      anchorItem("/in/ordinal-officer/", [
        nameRun("span", "Ordinal Officer"),
        nameRun("span", "• 1st"),
        nameRun("span", "1st Officer at Acme"),
        nameRun("span", "18h •"),
      ]),
    );

    expect(scraped.name).toBe("Ordinal Officer");
    expect(scraped.headline).toBe("1st Officer at Acme");
    expect(scraped.timestamp).toBe("18h");
  });

  it("#898: a field that CONTAINS the actor's own name IS reported as a headline", () => {
    // A company actor block whose second field opens with the company's own
    // name.  This test previously asserted the opposite — that the field was
    // discarded and the post reported no headline — and that expectation was
    // the DEFECT, written down.
    //
    // The rule it described tested each field's CONTENT against the resolved
    // name, so it could not tell the name's own field from a headline that
    // merely contains the name and discarded both.  On LinkedIn the second is a
    // whole class: eponymous consultancies, and the "Name | Role" pattern.  The
    // field the name was actually READ FROM is known without any content test,
    // so the headline is now excluded from those indices instead.
    //
    // The three-field shape below is the one where that cost was cheapest to
    // accept, because the pre-#860 `<p>`-indexed read returned null here too:
    // it took the 3rd `<p>` guarded on `pEls.length >= 3`, and the timestamp
    // loop spliced one of the three out first, leaving two.  A FOUR-field
    // anchor is where the trade-off actually failed — there the old read
    // returned `pEls[2]` whatever it contained, so it DID return these
    // headlines, and shapes R1/R2 in the corpus at the end of this file now
    // measure exactly that against the pinned baseline.
    const scraped = scrapeAuthor(
      anchorItem("/company/acme-corp/", [
        nameRun("p", "Acme Corp"),
        nameRun("p", "Acme Corp | Official"),
        nameRun("p", "18h •"),
      ]),
    );

    expect(scraped.name).toBe("Acme Corp");
    expect(scraped.headline).toBe("Acme Corp | Official");
    expect(scraped.timestamp).toBe("18h");
  });

  it("#898: an anchor rendering only a name and a time keeps a null headline", () => {
    // A company actor block, which renders no headline.  The name's own field
    // must not become the headline just because it is the first one left.
    const scraped = scrapeAuthor(
      anchorItem("/company/acme-corp/", [
        nameRun("p", "Acme Corp"),
        nameRun("p", "18h •"),
      ]),
    );

    expect(scraped.name).toBe("Acme Corp");
    expect(scraped.headline).toBeNull();
    expect(scraped.timestamp).toBe("18h");
    expect(scraped.url).toBe("https://www.linkedin.com/company/acme-corp/");
  });
});

// ---------------------------------------------------------------------------
// The headline axis: a headline containing the actor's name, and actor-header
// chrome sitting in the badge position
// ---------------------------------------------------------------------------

/**
 * Both defects these tests cover were live while this suite was fully green,
 * because the shapes that trigger them were absent from its corpus.  The
 * differential guard at the end of this file now carries them too (R1-R7), so
 * the regression is caught against the pinned baseline and not only against
 * the expectations written here.
 *
 * Every shape below is HAND-BUILT from the prose DOM notes in `get-feed.ts`.
 * This repository holds no captured feed-dialect DOM fixture at all, so a green
 * run is evidence about shapes someone reasoned out — not evidence of
 * real-markup coverage.
 */

/** The two `<p>` dialects: four bare runs, or four runs each in its own wrapper. */
const P_DIALECTS = [
  { label: "bareP", build: (...v: string[]): FakeElement[] => bareFields("p", ...v) },
  { label: "wrapP", build: (...v: string[]): FakeElement[] => wrappedFields("p", ...v) },
] as const;

describe("get-feed keeps a genuine headline that contains the actor's name", () => {
  // An eponymous consultancy and the "Name | Role" pattern are ordinary on
  // LinkedIn, so a rule that discarded any field containing the name discarded
  // a whole class of real headlines.  The name's own field is excluded by the
  // index it was READ FROM instead, which these shapes pin from the outside:
  // they assert the reported headline, never how the exclusion is computed.
  const EPONYMOUS = [
    "Ada Lovelace Consulting",
    "Founder at Ada Lovelace Studio",
    "Ada Lovelace | Speaker & Author",
    "Lovelace Analytics",
  ] as const;

  for (const dialect of P_DIALECTS) {
    for (const headline of EPONYMOUS) {
      it(`${dialect.label}: "${headline}" is the headline, not null`, () => {
        const scraped = scrapeAuthor(
          anchorItem(
            "/in/ada-lovelace/",
            dialect.build("Ada Lovelace", "• 1st", headline, "18h •"),
          ),
        );

        expect(scraped.name).toBe("Ada Lovelace");
        expect(scraped.headline).toBe(headline);
        expect(scraped.timestamp).toBe("18h");
        expect(scraped.url).toBe("https://www.linkedin.com/in/ada-lovelace/");
      });

      it(`${dialect.label}, no badge field: "${headline}" is the headline`, () => {
        // The three-field shape, where the name region reaches the headline and
        // the slug score is the only thing separating them.
        const scraped = scrapeAuthor(
          anchorItem("/in/ada-lovelace/", dialect.build("Ada Lovelace", headline, "18h •")),
        );

        expect(scraped.name).toBe("Ada Lovelace");
        expect(scraped.headline).toBe(headline);
        expect(scraped.timestamp).toBe("18h");
      });
    }
  }

  it("the name's own field is still not the headline when it carries a badge", () => {
    // The suppression must survive being narrowed to the name's origin: the
    // contaminated single field is index 0, so it is still excluded.
    const scraped = scrapeAuthor(
      anchorItem("/in/ada-lovelace/", [
        hiddenRun("Ada Lovelace · 1st"),
        hiddenRun("Head of Widgets at Acme"),
        hiddenRun("18h •"),
      ]),
    );

    expect(scraped.name).toBe("Ada Lovelace");
    expect(scraped.headline).toBe("Head of Widgets at Acme");
  });

  it("neither fragment of a split name becomes the headline", () => {
    // The other family: the name spans indices 0..1, so both are excluded and
    // the headline is the first field after them.
    const scraped = scrapeAuthor(
      anchorItem("/in/ada-multi/", [
        hiddenRun("Ada"),
        hiddenRun("Multi"),
        hiddenRun("• 1st"),
        hiddenRun("Head of Widgets at Acme"),
        hiddenRun("18h •"),
      ]),
    );

    expect(scraped.name).toBe("Ada Multi");
    expect(scraped.headline).toBe("Head of Widgets at Acme");
    expect(scraped.timestamp).toBe("18h");
  });
});

describe("get-feed skips actor-header chrome in the badge position", () => {
  // The headline is chosen by EXCLUSION, so every token the classifiers fail to
  // recognise is emitted to the user AS the headline.  These are the tokens
  // that were emitted that way.
  const CHROME = [
    "• Following",
    "Following",
    "+ Follow",
    "• Follow",
    "• Premium",
    "Promoted",
    "• 1st degree connection",
  ] as const;

  for (const dialect of P_DIALECTS) {
    for (const token of CHROME) {
      it(`${dialect.label}: "${token}" is chrome, so the real headline survives`, () => {
        const scraped = scrapeAuthor(
          anchorItem(
            "/in/ada-lovelace/",
            dialect.build("Ada Lovelace", token, "Head of Widgets at Acme", "18h •"),
          ),
        );

        expect(scraped.name).toBe("Ada Lovelace");
        expect(scraped.headline).toBe("Head of Widgets at Acme");
        expect(scraped.timestamp).toBe("18h");
      });
    }
  }

  it("a company actor header's follow state does not displace its headline", () => {
    // The whole reason this is a class rather than a corner: "• Following" is
    // the ordinary follow-state token in a company actor header.
    const scraped = scrapeAuthor(
      anchorItem("/company/acme-corp/", [
        nameRun("p", "Acme Corp"),
        nameRun("p", "• Following"),
        nameRun("p", "Widgets for everyone"),
        nameRun("p", "18h •"),
      ]),
    );

    expect(scraped.name).toBe("Acme Corp");
    expect(scraped.headline).toBe("Widgets for everyone");
    expect(scraped.timestamp).toBe("18h");
    expect(scraped.url).toBe("https://www.linkedin.com/company/acme-corp/");
  });

  // The chrome match is anchored to the WHOLE field, so a real headline that
  // merely opens with one of these words is a headline.  Pinned rather than
  // merely intended: an unanchored match would eat both of these.
  const NOT_CHROME = ["Following the Money at Acme", "Premium Support Lead"] as const;

  for (const headline of NOT_CHROME) {
    it(`"${headline}" is a headline, not chrome`, () => {
      const scraped = scrapeAuthor(
        anchorItem(
          "/in/ada-lovelace/",
          bareFields("p", "Ada Lovelace", "• 1st", headline, "18h •"),
        ),
      );

      expect(scraped.name).toBe("Ada Lovelace");
      expect(scraped.headline).toBe(headline);
    });
  }

  // The degree vocabulary that already worked, re-asserted so widening the
  // class cannot quietly drop any of it.  A bare "•" carries no letter or
  // digit, so it never becomes a field at all — asserted here by its outcome,
  // which is the same one.
  const BADGES = ["• 1st", "• 2nd", "• 3rd", "• 3rd+", "• You", "1st", "· 1st", "•"] as const;

  for (const badge of BADGES) {
    it(`"${badge}" in the badge position keeps the real headline`, () => {
      const scraped = scrapeAuthor(
        anchorItem(
          "/in/ada-lovelace/",
          bareFields("p", "Ada Lovelace", badge, "Head of Widgets at Acme", "18h •"),
        ),
      );

      expect(scraped.name).toBe("Ada Lovelace");
      expect(scraped.headline).toBe("Head of Widgets at Acme");
      expect(scraped.timestamp).toBe("18h");
    });
  }
});

describe("get-feed classifies a year-old relative time as a timestamp", () => {
  // `Nmo` was added when the extractor could classify neither; `Ny` / `Nyr`
  // remained unhandled, so "1y •" became the HEADLINE and the timestamp was
  // null.  `parseTimestamp` in the same module accepts both units too, so the
  // token this now emits is one the parser reads rather than drops.
  for (const token of ["1y", "2y", "1yr", "11yr"] as const) {
    it(`"${token} •" is the timestamp, not the headline`, () => {
      const scraped = scrapeAuthor(
        anchorItem(
          "/in/ada-lovelace/",
          bareFields("p", "Ada Lovelace", "• 1st", "Head of Widgets at Acme", `${token} •`),
        ),
      );

      expect(scraped.name).toBe("Ada Lovelace");
      expect(scraped.headline).toBe("Head of Widgets at Acme");
      expect(scraped.timestamp).toBe(token);
    });
  }
});

// ---------------------------------------------------------------------------
// #860 / #898 corpus, and the differential guard against the pre-#860 script
// ---------------------------------------------------------------------------

/**
 * Round 1 of #860 fixed five shapes and silently broke six others that the
 * previous rule had answered correctly.  Nothing in the suite could see that:
 * every test asserted the NEW behaviour, so a regression against the OLD
 * behaviour was invisible by construction, and the break was found only by a
 * reviewer running a hand-built differential afterwards.
 *
 * This section is that differential, made permanent.  A corpus of shapes is
 * graded twice — once through the script as it stands, once through a frozen
 * copy of the script as it stood before #860 — and the guard asserts that the
 * set of (shape, field) pairs the baseline got right and this script gets wrong
 * is EMPTY.  Adding a shape to `FIELD_SHAPES` therefore costs nothing: both
 * readings are computed, so no one has to remember to measure the old one.
 *
 * ## Why the baseline is frozen here rather than read from git
 *
 * The alternative was `git show <sha>:…` at test time.  It was rejected: the
 * object is not reachable from a shallow CI checkout, which is what
 * `actions/checkout` produces by default, and the two ways out of that are both
 * worse than duplication — failing the run on a machine whose checkout is
 * simply shallow, or skipping the guard there, which silently turns the one
 * test that would have caught round 1 into a no-op on the surface that matters.
 * The copy below is hermetic: no git, no network, no history.
 *
 * **It is a PINNED BASELINE and must never be "updated" to match a later
 * version of the script.**  Its whole value is that it does not move.  It is
 * `SCRAPE_FEED_POSTS_SCRIPT` as of commit `89d866ce`
 * (`packages/core/src/operations/get-feed.ts`), copied verbatim.
 *
 * ## What these verdicts cannot say
 *
 * Every shape below is HAND-BUILT from the prose DOM notes in `get-feed.ts`.
 * The repository holds no captured feed-dialect DOM fixture at all —
 * `linkedin/__fixtures__/` carries two post-detail captures, and its README
 * records that the feed was serving a DIFFERENT dialect at capture time.  So a
 * green run here is evidence about shapes someone reasoned out, and is not
 * evidence of real-markup coverage.
 */

const BASELINE_FEED_SCRIPT = `(() => {
  const posts = [];
  if (window.__lhrNextIdx == null) window.__lhrNextIdx = 0;

  // --- Author anchor helpers ---
  // The author name and the author profile URL are read from ONE anchor, so
  // they can never describe two different people.  These helpers use nothing
  // but an anchor's href and its own text content, which every DOM dialect
  // shares, so the read does not depend on any dialect-specific marker.

  // Profile anchors inside a post, in document order.
  function profileLinksIn(item) {
    return Array.from(item.querySelectorAll('a[href*="/in/"], a[href*="/company/"]'));
  }

  // The same profile anchors PLUS the two elements that close the post's actor
  // header: the control-menu button and the post body.  Queried together in one
  // call, because a single \`querySelectorAll\` returns nodes in document order
  // by spec — so the boundary is the anchors' real position relative to those
  // markers rather than an assumption about the markup's shape.
  const HEADER_SCAN_SELECTOR =
    'a[href*="/in/"], a[href*="/company/"], ' +
    'button[aria-label^="Open control menu for post"], ' +
    '[data-testid="expandable-text-box"]';

  // The profile anchors rendered inside the post's actor header — those before
  // the FIRST of the control-menu button and the post body.  Both markers are
  // already load-bearing here (post detection and text extraction), so bounding
  // the region adds no new dialect dependency; taking whichever comes first is
  // what makes the bound hold whichever order LinkedIn serves them in.
  //
  // Returns an empty list when the region is empty OR when neither marker is
  // present at all — both mean "this signal has nothing to say", and the caller
  // falls back.  Returning every link in the post instead would not restore the
  // previous behaviour, it would invent a third one: the cascade below this
  // region is first-wins, so handing it an unbounded list to resolve last-wins
  // would select mentions and embedded actors by construction.
  function headerLinksIn(item, links) {
    const ordered = Array.from(item.querySelectorAll(HEADER_SCAN_SELECTOR));
    const boundary = ordered.findIndex(function (node) {
      return links.indexOf(node) < 0;
    });
    return boundary < 0 ? [] : ordered.slice(0, boundary);
  }

  // The last element of a list satisfying a predicate, or null.
  function lastWhere(list, pred) {
    for (let i = list.length - 1; i >= 0; i--) {
      if (pred(list[i])) return list[i];
    }
    return null;
  }

  // Path part of an anchor's href, or null when it cannot be parsed.
  function linkPath(a) {
    try {
      return new URL(a.href).pathname;
    } catch (err) {
      return null;
    }
  }

  function hasVisibleText(a) {
    return (a.textContent || '').trim().length > 0;
  }

  // A relative-time token — "18h", "3d", "45m" — followed by the separator
  // LinkedIn renders after it, or by the end of the run.  Same token vocabulary
  // the timestamp read below uses; this form is unanchored because it is tested
  // against an anchor's whole concatenated text rather than one trimmed <p>.
  const RELATIVE_TIME_IN_TEXT = /\\d+[smhdw](?:\\s|[\\u2022\\u00B7]|$)/;

  // Text carrying no letter and no digit is decoration — a separator bullet, an
  // icon glyph — and is never a name.
  const NAME_LIKE = /[\\p{L}\\p{N}]/u;

  // Where inside an anchor the name a reader sees is rendered.  LinkedIn writes
  // the name twice: the visible copy wrapped in \`aria-hidden="true"\`, and a
  // screen-reader-only copy beside it that reads "View <name>'s profile" or
  // repeats the name with the connection degree appended.  Either may come
  // first in document order, so position cannot tell them apart — the wrapper
  // can.
  //
  // An anchor often carries several wrappers, one per field: the name, then the
  // connection degree, the headline, the timestamp, sometimes the avatar's
  // initials.  They are NOT joined — that swallows the neighbouring fields into
  // the name.  The name is the one rendered as a run, the same <p>/<span> shape
  // every other read here keys on, where a badge or a set of initials is bare
  // text in its wrapper.  Outermost wrappers only, so a nested one is not
  // considered twice, and decoration-only wrappers are dropped so a separator
  // bullet can never become the name.
  function visibleRoot(a) {
    const parts = [];
    for (const node of Array.from(a.querySelectorAll('[aria-hidden="true"]'))) {
      const txt = (node.textContent || '').trim();
      if (!txt || !NAME_LIKE.test(txt)) continue;
      if (parts.some(function (p) { return p.contains(node); })) continue;
      parts.push(node);
    }
    return parts.find(hasNameRun) || parts[0] || a;
  }

  // The name runs an element renders: <p> in the SDUI shape, <span> in the
  // legacy one.  Asking only WHETHER a run exists — never which tag carries it
  // — is what keeps every read below dialect-agnostic.  One selector list, not
  // two queries concatenated: the callers below take the FIRST run, and two
  // queries would order every <p> ahead of every <span> rather than in document
  // order, so a headline could outrank a name an anchor renders before it.
  function nameRuns(root) {
    return Array.from(root.querySelectorAll('p, span'));
  }

  // Does the anchor render its name inside a run, rather than as bare link text?
  function hasNameRun(a) {
    return nameRuns(a).some(function (node) {
      return NAME_LIKE.test((node.textContent || '').trim());
    });
  }

  // Is this anchor's profile linked more than once inside the post?  LinkedIn
  // usually links the author twice — once for the avatar, once for the name
  // block — while chips and mentions are linked once.
  function isPairedIn(links) {
    return function (a) {
      const path = linkPath(a);
      if (path === null) return false;
      return links.filter(function (other) { return linkPath(other) === path; }).length > 1;
    };
  }

  // The author among the anchors of the post's actor header.
  //
  // Inside that region POSITION is evidence, which it is nowhere else: every
  // decoy the region still admits — a repost chip, an "X commented on this"
  // chip — renders BEFORE the actor's own block, never after it.  So each
  // signal takes the LAST anchor it admits rather than the first.
  //
  //   1. The author's profile is linked twice (avatar + name block); a chip is
  //      linked once.
  //   2. Failing that, the actor block renders its name inside a run where a
  //      chip may be bare text.
  //   3. Failing that, position alone: the last anchor carrying any text.
  //
  // Signal 1 counts multiplicity WITHIN the region, never across the whole post.
  // Both of the author's anchors — avatar and name block — are inside the actor
  // header, so the region loses nothing by being the corpus; counting across the
  // post instead lets a chip win on evidence drawn from outside the region it is
  // being ranked in.  A resharer who is also mentioned in the post's own body is
  // linked twice that way, and would outrank a singly-linked author.
  //
  // The relative-time signal is deliberately NOT consulted here.  It is a proxy
  // for "this is the actor block", and inside the header the region bound plus
  // position answer that question directly — while the proxy misfires outright
  // on a decoy whose own bare text ends in a time-like token ("Deco Yperson 2d"),
  // which is one of the shapes issue #859 measured.  It stays in the fallback
  // below, where there is no positional evidence to replace it.
  function pickHeaderAuthor(candidates) {
    const named = candidates.filter(hasVisibleText);
    if (named.length === 0) return null;
    return lastWhere(named, isPairedIn(candidates))
      || lastWhere(named, hasNameRun)
      || named[named.length - 1];
  }

  // The post's AUTHOR anchor — not merely a profile anchor.  Reading both
  // fields off one element makes them agree; picking the right element is what
  // makes them agree about the right person, and any profile link rendered
  // before the author's (a mention, a repost chip, a suggested connection) is a
  // candidate for being mistaken for it.
  //
  // An anchor's href and its own text are not enough on their own: a repost
  // chip that renders its name exactly the way the actor block does is
  // indistinguishable on those two inputs (issue #859).  The third input is
  // WHERE the anchor sits — inside the actor header or below it — which
  // \`headerLinksIn\` bounds using markers this script already depends on.
  //
  // So: prefer the actor header's own answer; fall back to the whole post only
  // when the header holds no text-bearing anchor at all, and there use the
  // original cascade unchanged, first-wins:
  //
  //   1. The anchor whose own text carries the [name, connection degree,
  //      headline, relative time] run this file's DOM notes describe.  The run
  //      is recognised by its time token, read off the anchor's text rather
  //      than off whichever element holds it, so both name shapes satisfy it.
  //   2. Failing that, the profile linked more than once.
  //   3. Failing that, the anchor wrapping its name in a run.
  //   4. Then the first anchor carrying any text, and finally the first anchor
  //      at all, so a post with only a text-less or empty author link still
  //      yields a URL rather than nothing.
  //
  // A quote-repost — a reshare carrying its own commentary — resolves correctly
  // out of this: the outer post has a body of its own, so the region closes on
  // it and the embedded original's actor anchors fall outside; the outer
  // resharer, who authored that commentary, is selected, and that is also who
  // LinkedIn's own control-menu label names.  A BARE reshare carries no
  // commentary and so no body of its own, and there the region closes on the
  // embedded original's body instead and the original author is selected —
  // which is the right answer for that shape, and the one issue #859's own
  // reproductions ask for.
  function findAuthorAnchor(item) {
    const links = profileLinksIn(item);
    if (links.length === 0) return null;

    const header = pickHeaderAuthor(headerLinksIn(item, links));
    if (header) return header;

    const named = links.filter(hasVisibleText);

    const dated = named.find(function (a) {
      return RELATIVE_TIME_IN_TEXT.test(a.textContent || '');
    });
    if (dated) return dated;

    const paired = named.find(isPairedIn(links));
    if (paired) return paired;

    return named.find(hasNameRun) || named[0] || links[0] || null;
  }

  // The visible name an anchor renders: the first run carrying a name inside
  // whichever part of the anchor holds the visible copy, or that part's own
  // bare text when it renders no run at all.
  function anchorName(a) {
    const root = visibleRoot(a);
    for (const node of nameRuns(root)) {
      const txt = (node.textContent || '').trim();
      if (txt && NAME_LIKE.test(txt)) return txt;
    }
    const bare = (root.textContent || '').trim();
    return bare && NAME_LIKE.test(bare) ? bare : null;
  }

  // --- Step 1: Find the feed list via data-testid ---
  const feedList = document.querySelector('[data-testid="mainFeed"]');
  if (!feedList) return posts;

  // --- Step 2: Iterate listitem children ---
  const items = feedList.querySelectorAll('div[role="listitem"]');
  for (const wrapper of items) {
    // The listitem wraps the actual post content in nested divs.
    // Some listitems may be zero-height (virtualized/hidden) or
    // non-post items (composer, suggestions).
    const item = wrapper;
    if (item.offsetHeight < 100) continue;

    // Detect real posts: must have a three-dot menu button
    const menuBtn = item.querySelector('button[aria-label^="Open control menu for post"]');
    if (!menuBtn) continue;

    // --- Discovery tagging ---
    // Tag each listitem with a unique index on first discovery so that
    // posts can be accumulated across scroll iterations despite LinkedIn
    // virtualising off-screen items out of the DOM.  The index value
    // itself isn't consumed by the Node-side logic — it's only used as
    // the DOM attribute payload so that already-seen items can be
    // recognised on subsequent scrapes.
    let _isNew = false;
    if (!item.hasAttribute('data-lhr-idx')) {
      item.setAttribute('data-lhr-idx', String(window.__lhrNextIdx++));
      _isNew = true;
    }

    // --- Author info ---
    let authorName = null;
    let authorHeadline = null;
    let authorProfileUrl = null;
    let timestamp = null;

    // Name and profile URL both come from the author anchor.  Reading them
    // from one element is what makes disagreement impossible: the control
    // menu's aria-label is deliberately NOT a name source, because nothing
    // ties it structurally to the anchor the URL comes from.
    const authorAnchor = findAuthorAnchor(item);
    if (authorAnchor) {
      authorProfileUrl = authorAnchor.href.split('?')[0] || null;
      authorName = anchorName(authorAnchor);

      // Headline + timestamp come from that same anchor: it carries the
      // <p> run [name, connection degree, headline, timestamp].
      const pEls = Array.from(authorAnchor.querySelectorAll('p'));

      // Timestamp: last <p> containing a relative-time token (e.g. "18h •")
      for (let i = pEls.length - 1; i >= 0; i--) {
        const txt = (pEls[i].textContent || '').trim();
        const timestampMatch = txt.match(/^(\\d+[smhdw])(?:\\s|[\\u2022\\u00B7]|$)/);
        if (timestampMatch) {
          timestamp = timestampMatch[1];
          pEls.splice(i, 1);
          break;
        }
      }

      // Headline: 3rd <p> (index 2) — after name and connection degree.
      // Company posts may have only 2 <p> elements (name + timestamp),
      // in which case authorHeadline stays null.
      if (pEls.length >= 3) {
        authorHeadline = (pEls[2].textContent || '').trim() || null;
      }
    }

    // --- Post text ---
    // The feed DOM uses data-testid="expandable-text-box" for post body
    // text.  The optional "… more" button is a child of the text box and
    // must be stripped before reading textContent.
    let text = null;
    const textBox = item.querySelector('[data-testid="expandable-text-box"]');
    if (textBox) {
      const clone = textBox.cloneNode(true);
      const moreBtn = clone.querySelector('[data-testid="expandable-text-button"]');
      if (moreBtn) moreBtn.remove();
      text = (clone.textContent || '').trim() || null;
    }

    // --- Media type ---
    let mediaType = null;
    if (item.querySelector('video')) {
      mediaType = 'video';
    } else if (item.querySelector('img[src*="media.licdn.com"]')) {
      const imgs = item.querySelectorAll('img[src*="media.licdn.com"]');
      for (const img of imgs) {
        if (img.offsetHeight > 100) { mediaType = 'image'; break; }
      }
    }

    // --- Engagement counts ---
    const itemText = item.textContent || '';

    function parseCount(pattern) {
      const m = itemText.match(pattern);
      if (!m) return 0;
      const raw = m[1].replace(/,/g, '');
      const num = parseInt(raw, 10);
      return isNaN(num) ? 0 : num;
    }

    const reactionCount = parseCount(/(\\d[\\d,]*)\\s+reactions?/i);
    const commentCount = parseCount(/(\\d[\\d,]*)\\s+comments?/i);
    const shareCount = parseCount(/(\\d[\\d,]*)\\s+reposts?/i);

    posts.push({
      _isNew: _isNew,
      url: null,
      authorName: authorName,
      authorHeadline: authorHeadline,
      authorProfileUrl: authorProfileUrl,
      text: text,
      mediaType: mediaType,
      reactionCount: reactionCount,
      commentCount: commentCount,
      shareCount: shareCount,
      timestamp: timestamp,
    });
  }

  return posts;
})()`;

interface FieldShape {
  readonly label: string;
  readonly href: string;
  readonly children: () => FakeElement[];
  /** The truth for this shape, independent of what either script returns. */
  readonly name: string | null;
  readonly headline?: string | null;
  readonly timestamp?: string | null;
}

/** Four fields as bare runs directly inside the anchor — no wrapper. */
function bareFields(tag: RunTag, ...values: string[]): FakeElement[] {
  return values.map((v) => nameRun(tag, v));
}

/** Four fields, each inside its own `aria-hidden` wrapper. */
function wrappedFields(tag: RunTag, ...values: string[]): FakeElement[] {
  return values.map((v) => hiddenRun(v, tag));
}

const FIELD_SHAPES: readonly FieldShape[] = [
  // -- the five shapes #860 round 1 fixed -----------------------------------
  {
    label: "S1 split-2-wrappers+badge",
    href: "/in/ada-multi/",
    children: () => [hiddenRun("Ada"), hiddenRun("Multi"), hiddenRun("• 1st")],
    name: "Ada Multi",
  },
  {
    label: "S2 fused-degree-in-name-wrapper",
    href: "/in/ada-lovelace/",
    children: () => wrappedFields("span", "Ada Lovelace · 1st", "Head of Widgets at Acme", "18h •"),
    name: "Ada Lovelace",
    headline: "Head of Widgets at Acme",
    timestamp: "18h",
  },
  {
    label: "S3 bare-name + run-badge",
    href: "/in/ada-lovelace/",
    children: () => [hiddenBare("Ada Lovelace"), hiddenRun("2nd")],
    name: "Ada Lovelace",
    headline: null,
  },
  {
    label: "S4 bare-name + run-timestamp",
    href: "/in/ada-lovelace/",
    children: () => [hiddenBare("Ada Lovelace"), hiddenRun("18h •")],
    name: "Ada Lovelace",
    headline: null,
    timestamp: "18h",
  },
  {
    label: "S5 bare-name + run-headline",
    href: "/in/ada-lovelace/",
    children: () => [hiddenBare("Ada Lovelace"), hiddenRun("Mathematician")],
    name: "Ada Lovelace",
    headline: "Mathematician",
  },
  {
    label: "S11 split-3-wrappers-p",
    href: "/in/mary-jane-watson/",
    children: () => [hiddenRun("Mary", "p"), hiddenRun("Jane", "p"), hiddenRun("Watson", "p"), hiddenRun("• 1st", "p")],
    name: "Mary Jane Watson",
  },
  // -- the shapes it preserved ----------------------------------------------
  {
    label: "S6 legacy-4-span",
    href: "/in/legacy-author/",
    children: () => bareFields("span", "Legacy Author", "• 1st", "Head of Widgets at Acme", "18h •"),
    name: "Legacy Author",
    headline: "Head of Widgets at Acme",
    timestamp: "18h",
  },
  {
    label: "S7 sdui-4-p",
    href: "/in/sdui-author/",
    children: () => bareFields("p", "Sdui Author", "• 1st", "Head of Widgets at Acme", "18h •"),
    name: "Sdui Author",
    headline: "Head of Widgets at Acme",
    timestamp: "18h",
  },
  {
    label: "S8 single-run",
    href: "/in/solo-author/",
    children: () => [nameRun("span", "Solo Author")],
    name: "Solo Author",
    headline: null,
    timestamp: null,
  },
  {
    label: "S9 clean-per-wrapper",
    href: "/in/clean-author/",
    children: () => wrappedFields("span", "Clean Author", "• 2nd", "Head of Widgets at Acme", "18h •"),
    name: "Clean Author",
    headline: "Head of Widgets at Acme",
    timestamp: "18h",
  },
  {
    label: "S10 wrapped-p",
    href: "/in/wrapped-author/",
    children: () => wrappedFields("p", "Wrapped Author", "• 2nd", "Head of Widgets at Acme", "18h •"),
    name: "Wrapped Author",
    headline: "Head of Widgets at Acme",
    timestamp: "18h",
  },
  {
    label: "S12 company",
    href: "/company/acme-corp/",
    children: () => bareFields("p", "Acme Corp", "18h •"),
    name: "Acme Corp",
    headline: null,
    timestamp: "18h",
  },
  // -- BLOCKER 1: a role / brand / nickname slug must not win the name slot --
  {
    label: "V1 role-slug, bare span runs",
    href: "/in/head-of-widgets/",
    children: () => bareFields("span", "Ada Lovelace", "• 1st", "Head of Widgets at Acme", "18h •"),
    name: "Ada Lovelace",
    headline: "Head of Widgets at Acme",
    timestamp: "18h",
  },
  {
    label: "V2 role-slug, SDUI p runs",
    href: "/in/head-of-widgets/",
    children: () => bareFields("p", "Ada Lovelace", "• 1st", "Head of Widgets at Acme", "18h •"),
    name: "Ada Lovelace",
    headline: "Head of Widgets at Acme",
    timestamp: "18h",
  },
  {
    label: "V3 role-slug, wrapped runs",
    href: "/in/head-of-widgets/",
    children: () => wrappedFields("span", "Ada Lovelace", "• 1st", "Head of Widgets at Acme", "18h •"),
    name: "Ada Lovelace",
    headline: "Head of Widgets at Acme",
    timestamp: "18h",
  },
  {
    label: "V5 personal-brand slug",
    href: "/in/thegrowthguy/",
    children: () => bareFields("span", "Dana Ruiz", "• 1st", "The Growth Guy", "4h •"),
    name: "Dana Ruiz",
    headline: "The Growth Guy",
    timestamp: "4h",
  },
  {
    label: "V6 nickname slug",
    href: "/in/coach-mike/",
    children: () => bareFields("span", "Michael Byrne", "• 1st", "Coach Mike", "5h •"),
    name: "Michael Byrne",
    headline: "Coach Mike",
    timestamp: "5h",
  },
  {
    label: "V8 role-slug on a company page",
    href: "/company/head-of-widgets/",
    children: () => bareFields("p", "Acme Corp", "Head of Widgets", "18h •"),
    name: "Acme Corp",
    headline: "Head of Widgets",
    timestamp: "18h",
  },
  {
    label: "V9 hash slug beside the matching degree, separate fields",
    href: "/in/john-smith-1a2b3c/",
    children: () => bareFields("span", "John Smith", "• 1st", "Head of Widgets at Acme", "18h •"),
    name: "John Smith",
    headline: "Head of Widgets at Acme",
    timestamp: "18h",
  },
  {
    label: "V10 hash slug beside the matching degree, FUSED into one field",
    href: "/in/john-smith-1a2b3c/",
    children: () => bareFields("span", "John Smith · 1st", "Head of Widgets at Acme", "18h •"),
    name: "John Smith",
    headline: "Head of Widgets at Acme",
    timestamp: "18h",
  },
  // -- BLOCKER 2: a slug that merely PREFIXES the name must not truncate it --
  {
    label: "B2a credential suffix",
    href: "/in/ada-lovelace/",
    children: () => bareFields("span", "Ada Lovelace, PhD", "• 1st", "Head of Widgets at Acme", "18h •"),
    name: "Ada Lovelace, PhD",
    headline: "Head of Widgets at Acme",
    timestamp: "18h",
  },
  {
    label: "B2b double surname",
    href: "/in/maria-garcia/",
    children: () => bareFields("span", "María García López", "• 1st", "Head of Widgets at Acme", "18h •"),
    name: "María García López",
    headline: "Head of Widgets at Acme",
    timestamp: "18h",
  },
  {
    label: "B2c hyphenated given name plus particle surname",
    href: "/in/anne-marie-berg/",
    children: () => bareFields("span", "Anne-Marie Van Der Berg", "• 1st", "Head of Widgets at Acme", "18h •"),
    name: "Anne-Marie Van Der Berg",
    headline: "Head of Widgets at Acme",
    timestamp: "18h",
  },
  {
    label: "B2d middle name",
    href: "/in/maria-garcia/",
    children: () => bareFields("span", "María José García Pérez", "• 1st", "Head of Widgets at Acme", "18h •"),
    name: "María José García Pérez",
    headline: "Head of Widgets at Acme",
    timestamp: "18h",
  },
  // -- BLOCKER 3: a slug of three characters or fewer is still usable --------
  {
    label: "B3a three-character company slug",
    href: "/company/ibm/",
    children: () => bareFields("p", "IBM", "Technology", "18h •"),
    name: "IBM",
    headline: "Technology",
    timestamp: "18h",
  },
  {
    label: "B3b two-character company slug",
    href: "/company/ge/",
    children: () => bareFields("p", "GE", "18h •"),
    name: "GE",
    headline: null,
    timestamp: "18h",
  },
  {
    // The ACCEPT path's form of the decline-path defect. "ada" scores 3 against
    // a bar of `min(4, 3)`, so the read ACCEPTS at the one-field prefix "Ada"
    // -- accepting is not the same as consuming the whole name -- and before
    // the accept branch was widened, "Lovelace" won the headline race.
    label: "B3e short slug accepts a PREFIX of a split name",
    href: "/in/ada/",
    children: () => bareFields("p", "Ada", "Lovelace", "• 1st", "Head of Widgets", "18h •"),
    name: "Ada",
    headline: "Head of Widgets",
    timestamp: "18h",
  },
  {
    // Same accept-path defect reached by a different route: the surname folds
    // to the empty string, so extending the candidate over it neither gains nor
    // costs score and the shorter candidate holds the tie. The wholly non-Latin
    // shape CANNOT reach this branch -- it folds to empty, scores zero and
    // declines -- so only a mixed-script name exercises it.
    label: "B3f mixed-script name, Latin given name and non-Latin surname",
    href: "/in/alex-petrenko/",
    children: () => bareFields("p", "Alex", "Петренко", "• 1st", "Head of Widgets", "18h •"),
    name: "Alex",
    headline: "Head of Widgets",
    timestamp: "18h",
  },
  {
    // `Out of network` is a connection degree every sibling extractor in this
    // repository classifies -- dom-variant.ts twice, get-post.ts twice -- and
    // this file omitted it while its own comment quoted their vocabulary
    // WITHOUT it, so the parity claim read as met. The headline rule chooses by
    // exclusion and has no positive test, so an unclassified badge is emitted
    // AS the headline; the pre-#860 script read this shape correctly, making it
    // a regression rather than a cost.
    label: "B3g out-of-network degree is a badge, not a headline",
    href: "/in/ada-lovelace/",
    children: () => bareFields("p", "Ada Lovelace", "• Out of network", "Head of Widgets at Acme", "18h •"),
    name: "Ada Lovelace",
    headline: "Head of Widgets at Acme",
    timestamp: "18h",
  },
  {
    // B3a and B3b are CLEAN shapes -- the name is field 0, uncontaminated -- so
    // `anchorName` answers them identically to the scored path and neither can
    // fail if the short-slug allowance is removed. This one contaminates the
    // field, which is what makes the allowance observable: with the
    // `Math.min(MIN_SLUG_MATCH, target.length)` bar, "ibm" scores 3 against a
    // bar of 3 and the badge is trimmed; with an absolute floor of 4 no
    // 3-character slug can ever clear it, the read declines to `anchorName`,
    // and #860's contamination family reopens for every short slug --
    // /company/ge/, /company/hp/, /company/sap/, /in/ada/ -- while B3a and B3b
    // stay green. Verified by mutation, not by inspection.
    label: "B3d three-character company slug, badge fused into the name field",
    href: "/company/ibm/",
    children: () => bareFields("p", "IBM · 1st", "Technology", "18h •"),
    name: "IBM",
    headline: "Technology",
    timestamp: "18h",
  },
  {
    label: "B3c short first-name slug does not truncate the name",
    href: "/in/mike/",
    children: () => bareFields("span", "Mike Johnson", "• 1st", "Head of Widgets at Acme", "18h •"),
    name: "Mike Johnson",
    headline: "Head of Widgets at Acme",
    timestamp: "18h",
  },
  // -- BLOCKER 5: tokens the classifiers used to miss ------------------------
  {
    label: "B5a own-post degree renders 'You'",
    href: "/in/ada-lovelace/",
    children: () => bareFields("span", "Ada Lovelace", "• You", "Head of Widgets at Acme", "18h •"),
    name: "Ada Lovelace",
    headline: "Head of Widgets at Acme",
    timestamp: "18h",
  },
  {
    label: "B5b month-old post renders Nmo",
    href: "/company/acme-corp/",
    children: () => bareFields("p", "Acme Corp", "1mo •"),
    name: "Acme Corp",
    headline: null,
    timestamp: "1mo",
  },
  {
    label: "B5c Nmo beside a real headline",
    href: "/in/ada-lovelace/",
    children: () => bareFields("span", "Ada Lovelace", "• 1st", "Head of Widgets at Acme", "3mo •"),
    name: "Ada Lovelace",
    headline: "Head of Widgets at Acme",
    timestamp: "3mo",
  },
  // -- FINDING 8: punctuation, diacritics, non-Latin script -----------------
  {
    label: "F8a internal hyphen survives",
    href: "/in/jean-luc-picard/",
    children: () => bareFields("span", "Jean-Luc Picard", "• 1st", "Head of Widgets at Acme", "18h •"),
    name: "Jean-Luc Picard",
    headline: "Head of Widgets at Acme",
    timestamp: "18h",
  },
  {
    label: "F8b internal apostrophe survives",
    href: "/in/patrick-obrien/",
    children: () => bareFields("span", "Patrick O'Brien", "• 1st", "Head of Widgets at Acme", "18h •"),
    name: "Patrick O'Brien",
    headline: "Head of Widgets at Acme",
    timestamp: "18h",
  },
  {
    label: "F8c diacritics fold to the ASCII slug",
    href: "/in/renee-dubois/",
    children: () => bareFields("span", "Renée Dubois", "• 1st", "Head of Widgets at Acme", "18h •"),
    name: "Renée Dubois",
    headline: "Head of Widgets at Acme",
    timestamp: "18h",
  },
  {
    label: "F8d diaeresis folds to the ASCII slug",
    href: "/in/zoe-hart/",
    children: () => bareFields("span", "Zoë Hart", "• 1st", "Head of Widgets at Acme", "18h •"),
    name: "Zoë Hart",
    headline: "Head of Widgets at Acme",
    timestamp: "18h",
  },
  {
    label: "F8e non-Latin name against a transliterated slug",
    href: "/in/ivan-petrov/",
    children: () => bareFields("span", "Іван Петров", "• 1st", "Head of Widgets at Acme", "18h •"),
    name: "Іван Петров",
    headline: "Head of Widgets at Acme",
    timestamp: "18h",
  },
  {
    label: "F8f wrapper-bearing anchor still yields headline and timestamp (legacy span)",
    href: "/in/wrapped-legacy/",
    children: () => wrappedFields("span", "Wrapped Legacy", "• 1st", "Head of Widgets at Acme", "18h •"),
    name: "Wrapped Legacy",
    headline: "Head of Widgets at Acme",
    timestamp: "18h",
  },
  {
    label: "F8g a short name does not swallow a headline that merely starts with it",
    href: "/in/ada/",
    children: () => bareFields("span", "Ada", "• 1st", "Adaptive Systems Lead", "18h •"),
    name: "Ada",
    headline: "Adaptive Systems Lead",
    timestamp: "18h",
  },
  {
    // The declared truth here was `headline: null` — the defect, recorded as
    // the expectation.  A field containing the actor's own name is a headline;
    // only the field the name was READ FROM is not.
    label: "F6 company field containing the actor's own name",
    href: "/company/acme-corp/",
    children: () => bareFields("p", "Acme Corp", "Acme Corp | Official", "18h •"),
    name: "Acme Corp",
    headline: "Acme Corp | Official",
    timestamp: "18h",
  },
  // -- round 3: the headline axis --------------------------------------------
  //
  // Every shape below was ABSENT from this corpus while its defect was live,
  // which is why a fully green suite said nothing about either finding.  The
  // baseline is right about the headline on R1-R5 because the pre-#860 read
  // took the 3rd `<p>` whatever it contained; that is what makes them
  // differential evidence rather than merely new assertions.
  {
    label: "R1 four-field-p headline containing the actor's own name",
    href: "/in/ada-lovelace/",
    children: () => bareFields("p", "Ada Lovelace", "• 1st", "Ada Lovelace Consulting", "18h •"),
    name: "Ada Lovelace",
    headline: "Ada Lovelace Consulting",
    timestamp: "18h",
  },
  {
    label: "R2 four-field-p headline in the Name | Role pattern",
    href: "/in/ada-lovelace/",
    children: () => bareFields("p", "Ada Lovelace", "• 1st", "Ada Lovelace | Speaker & Author", "18h •"),
    name: "Ada Lovelace",
    headline: "Ada Lovelace | Speaker & Author",
    timestamp: "18h",
  },
  {
    label: "R3 company follow-state in the badge position",
    href: "/company/acme-corp/",
    children: () => bareFields("p", "Acme Corp", "• Following", "Widgets for everyone", "18h •"),
    name: "Acme Corp",
    headline: "Widgets for everyone",
    timestamp: "18h",
  },
  {
    label: "R4 unabbreviated degree in the badge position",
    href: "/in/ada-lovelace/",
    children: () => bareFields("p", "Ada Lovelace", "• 1st degree connection", "Head of Widgets at Acme", "18h •"),
    name: "Ada Lovelace",
    headline: "Head of Widgets at Acme",
    timestamp: "18h",
  },
  {
    label: "R5 headline whose first word is chrome vocabulary",
    href: "/in/ada-lovelace/",
    children: () => bareFields("p", "Ada Lovelace", "• 1st", "Following the Money at Acme", "18h •"),
    name: "Ada Lovelace",
    headline: "Following the Money at Acme",
    timestamp: "18h",
  },
  {
    label: "R6 wrapped-p headline containing the actor's own name",
    href: "/in/ada-lovelace/",
    children: () => wrappedFields("p", "Ada Lovelace", "• 1st", "Founder at Ada Lovelace Studio", "18h •"),
    name: "Ada Lovelace",
    headline: "Founder at Ada Lovelace Studio",
    timestamp: "18h",
  },
  {
    label: "R8 chrome Following in the badge position",
    href: "/in/ada-lovelace/",
    children: () => bareFields("p", "Ada Lovelace", "Following", "Head of Widgets at Acme", "18h •"),
    name: "Ada Lovelace",
    headline: "Head of Widgets at Acme",
    timestamp: "18h",
  },
  {
    label: "R9 chrome + Follow in the badge position",
    href: "/in/ada-lovelace/",
    children: () => bareFields("p", "Ada Lovelace", "+ Follow", "Head of Widgets at Acme", "18h •"),
    name: "Ada Lovelace",
    headline: "Head of Widgets at Acme",
    timestamp: "18h",
  },
  {
    label: "R10 chrome • Follow in the badge position",
    href: "/in/ada-lovelace/",
    children: () => bareFields("p", "Ada Lovelace", "• Follow", "Head of Widgets at Acme", "18h •"),
    name: "Ada Lovelace",
    headline: "Head of Widgets at Acme",
    timestamp: "18h",
  },
  {
    label: "R11 chrome • Premium in the badge position",
    href: "/in/ada-lovelace/",
    children: () => bareFields("p", "Ada Lovelace", "• Premium", "Head of Widgets at Acme", "18h •"),
    name: "Ada Lovelace",
    headline: "Head of Widgets at Acme",
    timestamp: "18h",
  },
  {
    label: "R12 chrome Promoted in the badge position",
    href: "/in/ada-lovelace/",
    children: () => bareFields("p", "Ada Lovelace", "Promoted", "Head of Widgets at Acme", "18h •"),
    name: "Ada Lovelace",
    headline: "Head of Widgets at Acme",
    timestamp: "18h",
  },
  {
    label: "R7 year-old reshared post",
    href: "/in/ada-lovelace/",
    children: () => bareFields("p", "Ada Lovelace", "• 1st", "Head of Widgets at Acme", "1y •"),
    name: "Ada Lovelace",
    headline: "Head of Widgets at Acme",
    timestamp: "1y",
  },
  // The eponymous-business slug family: no field between the name and the
  // headline, and a vanity slug whose tail continues into the headline's first
  // word.  An independent differential found these as a NEW name-axis
  // regression -- the pre-#860 read returned the name correctly on all of them,
  // and the slug-scored read fused the headline into the name.  They are here
  // rather than in the accepted-cost block because their truth is not
  // ambiguous: no reader attributes "Photography & Video" to a display name.
  {
    label: "G16b eponymous slug, multi-word headline adjacent",
    href: "/in/ada-lovelace-consulting/",
    children: () => bareFields("p", "Ada Lovelace", "Consulting for B2B SaaS", "18h •"),
    name: "Ada Lovelace",
    headline: "Consulting for B2B SaaS",
    timestamp: "18h",
  },
  {
    label: "G16c eponymous slug, photography business",
    href: "/in/john-smith-photography/",
    children: () => bareFields("span", "John Smith", "Photography & Video", "2h •"),
    name: "John Smith",
    headline: "Photography & Video",
    timestamp: "2h",
  },
  {
    label: "G16d eponymous slug, coaching business",
    href: "/in/jane-doe-coaching/",
    children: () => wrappedFields("p", "Jane Doe", "Coaching leaders", "1d •"),
    name: "Jane Doe",
    headline: "Coaching leaders",
    timestamp: "1d",
  },
  {
    // The control that proves the bound is a bound and not a blanket refusal to
    // cross a field boundary: the second field is corroborated except for a
    // two-character honorific, so it is still read as part of the name.
    label: "G16z split name whose last field carries a suffix",
    href: "/in/john-smith/",
    children: () => bareFields("p", "John", "Smith Jr", "• 1st", "Head of Widgets at Acme", "18h •"),
    name: "John Smith Jr",
    headline: "Head of Widgets at Acme",
    timestamp: "18h",
  },
  {
    // And the control that keeps the bound from being read as "never fuse a
    // long candidate": a badge between the two fields ends the name region, so
    // only one candidate exists and the slug's tail is irrelevant.
    label: "G16f eponymous slug with a badge between the fields",
    href: "/in/john-smith-photography/",
    children: () => bareFields("p", "John Smith", "• 1st", "Photography & Video", "2h •"),
    name: "John Smith",
    headline: "Photography & Video",
    timestamp: "2h",
  },
  {
    label: "B4 name in a wrapper whose only runs are empty",
    href: "/in/ada-lovelace/",
    children: () => [
      hiddenBareBesideEmptyRuns("Ada Lovelace"),
      hiddenRun("• 1st"),
      hiddenRun("Head of Widgets at Acme"),
      hiddenRun("18h •"),
    ],
    name: "Ada Lovelace",
    headline: "Head of Widgets at Acme",
    timestamp: "18h",
  },
];

/**
 * How many (shape, field) pairs the pinned baseline gets RIGHT across the
 * corpus.  Asserted as a floor by the differential guard so that an empty
 * regression list is evidence rather than an artefact of a degenerate
 * comparison; raise it when the corpus grows.
 */
const BASELINE_CORRECT_FIELDS = 84;

/**
 * A wrapper whose runs are all EMPTY, carrying its real text as a bare text
 * node beside them.
 *
 * Modelled on the one real actor-header capture this repository holds,
 * `linkedin/__fixtures__/legacy/post-with-comments.html` (lines 95-103), which
 * renders `<span aria-hidden="true">` around two whitespace-only
 * `white-space-pre` spans, an `<svg>`, and a bare "• Adi".  Those
 * whitespace-only spans ARE leaf runs, so a bare-text rescue gated on "this
 * root renders no run" never fires for this shape and the wrapper contributes
 * nothing at all.  On the capture itself the lost field is the connection
 * degree, which costs nothing; the same construction around the NAME loses the
 * name, which is what the fixture below renders.
 */
function hiddenBareBesideEmptyRuns(value: string): FakeElement {
  return el("span", { "aria-hidden": "true" }, [
    text("span", "", { class: "white-space-pre" }),
    text("span", "", { class: "white-space-pre" }),
  ], value);
}

/** Run an arbitrary scrape-script source against the document double. */
function runScrapeWith(script: string, root: FakeElement): ScrapedPost[] {
  const window: Record<string, unknown> = {};
  const fn = new Function("document", "window", `return ${script};`) as (
    document: unknown,
    window: unknown,
  ) => ScrapedPost[];
  return fn(makeDocument(root), window);
}

interface AuthorFields {
  readonly name: string | null;
  readonly headline: string | null;
  readonly timestamp: string | null;
  readonly url: string | null;
}

/** The four author fields `script` reports for one shape. */
function fieldsOf(script: string, shape: FieldShape): AuthorFields {
  const post = runScrapeWith(script, feedOf(anchorItem(shape.href, shape.children())))[0];
  return {
    name: post?.authorName ?? null,
    headline: post?.authorHeadline ?? null,
    timestamp: post?.timestamp ?? null,
    url: post?.authorProfileUrl ?? null,
  };
}

describe("get-feed author fields across the #860 / #898 corpus", () => {
  it("CANARY: the pinned baseline runs on these fixtures AND is a different script", () => {
    // Two things have to hold or every verdict below is vacuous.
    //
    // First the baseline must actually RUN on the document double — a frozen
    // copy that threw, or returned no post, would make the differential guard
    // compare a real reading against nothing and pass unconditionally.
    const shape = FIELD_SHAPES[0] as FieldShape;
    const item = feedOf(anchorItem(shape.href, shape.children()));
    const baselinePosts = runScrapeWith(BASELINE_FEED_SCRIPT, item);
    expect(baselinePosts).toHaveLength(1);
    expect(baselinePosts[0]?.text).toBe("Post body text that is long enough to be real.");
    expect(baselinePosts[0]?.authorProfileUrl).toBe(
      `https://www.linkedin.com${shape.href}`,
    );

    // Second the baseline must DIFFER from the current script.  If someone ever
    // "refreshes" the pinned copy from the working tree, the guard keeps
    // passing while measuring a script against itself — the failure mode that
    // makes a differential worthless, and the one nothing else here would show.
    const disagreements = FIELD_SHAPES.filter(
      (s) => fieldsOf(BASELINE_FEED_SCRIPT, s).name !== fieldsOf(SCRAPE_FEED_SCRIPT, s).name,
    );
    expect(disagreements.length).toBeGreaterThan(0);
  });

  for (const shape of FIELD_SHAPES) {
    it(`#860/#898: ${shape.label}`, () => {
      const got = fieldsOf(SCRAPE_FEED_SCRIPT, shape);

      expect(got.name).toBe(shape.name);
      if (shape.headline !== undefined) expect(got.headline).toBe(shape.headline);
      if (shape.timestamp !== undefined) expect(got.timestamp).toBe(shape.timestamp);
      // AC-4: the item renders exactly one anchor, so a URL that matches its
      // href is a URL read from the same element the name came from.
      expect(got.url).toBe(`https://www.linkedin.com${shape.href}`);
    });
  }

  it("#860 (bound): an OPAQUE slug hands back to the previous rule, it does not invent", () => {
    // The href is the disambiguator, so a slug encoding nothing about the name
    // leaves this read with nothing to say and it must decline.
    //
    // "Declines" is stated as an equality with the BASELINE's answer rather
    // than as the string that answer happens to be.  Naming the string would
    // pin the fallback's internal choice — here a truncated, wrong name — as
    // the required output, which is a mechanism assertion of exactly the kind
    // this file's own header forbids.  What is actually claimed is that when
    // the href carries no signal the behaviour is the behaviour that shipped
    // before, and that is what is measured.
    const shape: FieldShape = {
      label: "opaque slug",
      href: "/in/x7k2m9q4/",
      children: () => [hiddenRun("Ada"), hiddenRun("Multi"), hiddenRun("• 1st")],
      name: null,
    };
    const before = fieldsOf(BASELINE_FEED_SCRIPT, shape);
    const now = fieldsOf(SCRAPE_FEED_SCRIPT, shape);

    expect(now.name).toBe(before.name);
    // And it assembles nothing out of the fields it can see.
    expect(now.name).not.toBe("Ada Multi • 1st");
    expect(now.name).not.toBe("• 1st");
    expect(now.url).toBe("https://www.linkedin.com/in/x7k2m9q4/");
  });


  it("#898 (decline): a declining slug withholds the whole name region from the headline", () => {
    // The decline path knows the name only as the ONE field `anchorName`
    // answered from, so excluding just that field emitted the name's REMAINING
    // fragments as the headline -- the fallback inventing a headline out of the
    // very fragments the decline had admitted it could not delimit.
    //
    // Measured before the fix, on the same fixture the opaque-slug test above
    // already uses: name "Ada", headline "Multi".  The pre-#860 baseline
    // returned null for that headline, so it was a regression and not a cost.
    const split = fieldsOf(SCRAPE_FEED_SCRIPT, {
      label: "opaque slug, split name, nothing after the badge",
      href: "/in/x7k2m9q4/",
      children: () => [hiddenRun("Ada"), hiddenRun("Multi"), hiddenRun("• 1st")],
      name: null,
    });
    expect(split.headline).not.toBe("Multi");
    expect(split.headline).toBeNull();

    // And the region is withheld, not the whole read: put a real headline after
    // the badge and it is still found.  This is the assertion that fails if the
    // withholding is ever widened past the name region.
    const withHeadline = fieldsOf(SCRAPE_FEED_SCRIPT, {
      label: "opaque slug, split name, headline after the badge",
      href: "/in/x7k2m9q4/",
      children: () => [
        hiddenRun("Ada"),
        hiddenRun("Multi"),
        hiddenRun("• 1st"),
        hiddenRun("Head of Widgets at Acme"),
        hiddenRun("18h •"),
      ],
      name: null,
    });
    expect(withHeadline.headline).toBe("Head of Widgets at Acme");
    expect(withHeadline.timestamp).toBe("18h");
  });

  it("#898 (decline): a transliterated non-Latin slug does not report the surname as the headline", () => {
    // `squash` folds a non-Latin name to the empty string and says so in its own
    // comment: it "routes to the fallback -- the honest answer, since LinkedIn
    // transliterates such slugs and the two are not comparable here".  The name
    // read did fall back; the headline read did not, and reported the person's
    // SURNAME as their headline while displacing the real one.  Measured before
    // the fix: name "Олексій", headline "Пелих".
    //
    // This is the sharpest form of the shape above because both halves are a
    // real person's name, so nothing downstream can recognise the result as
    // wrong -- a plausible-looking headline is worse than a missing one.
    const got = fieldsOf(SCRAPE_FEED_SCRIPT, {
      label: "transliterated slug, non-Latin name",
      href: "/in/oleksii-pelykh/",
      children: () => [
        hiddenRun("Олексій"),
        hiddenRun("Пелих"),
        hiddenRun("• 1st"),
        hiddenRun("Head of Widgets"),
        hiddenRun("18h •"),
      ],
      name: null,
    });

    expect(got.headline).not.toBe("Пелих");
    expect(got.headline).toBe("Head of Widgets");
    expect(got.timestamp).toBe("18h");
  });

  it("#898 (decline): the withholding is keyed on a BADGE, so a company header keeps its headline", () => {
    // A company actor header renders no connection degree at all, so its name
    // region is terminated by the TIMESTAMP and legitimately spans name AND
    // headline.  Withholding the region there drops a real headline -- measured,
    // when the withholding was first written unconditionally, as null on the
    // corpus shape `V8 role-slug on a company page`.
    //
    // This is the assertion that fails if the withholding is ever widened back
    // to every declining read regardless of what terminates the region.
    const company = fieldsOf(SCRAPE_FEED_SCRIPT, {
      label: "company header, role slug, no badge",
      href: "/company/head-of-widgets/",
      children: () => bareFields("p", "Acme Corp", "Head of Widgets", "18h •"),
      name: "Acme Corp",
    });

    expect(company.name).toBe("Acme Corp");
    expect(company.headline).toBe("Head of Widgets");
  });

  it("#898 (decline, accepted cost): a split name with NO badge after it still reports its tail", () => {
    // The residue the badge-keyed rule above deliberately does not reach, and
    // the reason it cannot: this shape is field-for-field identical to the
    // company header in the test above -- two leading non-badge fields
    // terminated by a relative time -- so one rule cannot serve both, and #860's
    // premise is that the anchor's text alone does not say which is which.
    //
    // Asserted as the OBSERVED answer, not the ideal one, so that a later change
    // which fixes it fails here and has to say so.  Stated per this file's own
    // convention for costs: an accepted cost that silently stops being paid is
    // as invisible as one that silently starts.
    const got = fieldsOf(SCRAPE_FEED_SCRIPT, {
      label: "opaque slug, split name, no badge",
      href: "/in/x7k2m9q4/",
      children: () => [hiddenRun("Ada"), hiddenRun("Multi"), hiddenRun("18h •")],
      name: null,
    });

    expect(got.headline).toBe("Multi");
  });
  it("#860/#898 AC-3: no field the pre-#860 script got right is got wrong now", () => {
    const regressions: string[] = [];
    let baselineCorrect = 0;

    const check = (
      shape: FieldShape,
      axis: string,
      want: string | null | undefined,
      before: string | null,
      now: string | null,
    ): void => {
      if (want === undefined) return;
      if (before !== want) return;
      baselineCorrect++;
      if (now !== want) {
        regressions.push(
          `${shape.label} / ${axis}: baseline ${JSON.stringify(before)}, now ${JSON.stringify(now)}`,
        );
      }
    };

    for (const shape of FIELD_SHAPES) {
      const before = fieldsOf(BASELINE_FEED_SCRIPT, shape);
      const now = fieldsOf(SCRAPE_FEED_SCRIPT, shape);
      check(shape, "name", shape.name, before.name, now.name);
      check(shape, "headline", shape.headline, before.headline, now.headline);
      check(shape, "timestamp", shape.timestamp, before.timestamp, now.timestamp);
    }

    // Paired with the cardinality of what was graded.  A guard that found the
    // baseline correct about NOTHING would report an empty regression list for
    // the wrong reason — it would have compared nothing at all — so the count
    // is asserted alongside the verdict rather than left implicit.
    expect(baselineCorrect).toBeGreaterThanOrEqual(BASELINE_CORRECT_FIELDS);
    expect(regressions).toEqual([]);
  });
});

/**
 * The headline rule chooses by EXCLUSION and has no positive test of its own,
 * and the name read consumes whole fields.  Both properties have a price, and
 * the two tests below pin what that price actually IS rather than leaving it as
 * prose in a doc comment nobody re-runs.
 *
 * These assert behaviour this change knowingly does NOT get right.  They are
 * written as the OBSERVED answer, not the ideal one, so that a later change
 * which fixes either case fails here and has to say so — an accepted cost that
 * silently stops being paid is as invisible as one that silently starts.
 *
 * Every shape here is HAND-BUILT.  Issue #897 records that this repository
 * holds no captured feed-dialect DOM fixture, so neither of these is evidence
 * about real markup; they bound the mechanism, not the page.
 */
describe("#860/#898 accepted costs", () => {
  it("emits an unrecognised actor-header token AS the headline", () => {
    // "• Open to work" is not a connection degree and is not in HEADER_CHROME,
    // so nothing excludes it and it wins the first-surviving-field race.
    //
    // Falsifier, and the reason this is a cost rather than a defect: the fix is
    // to widen the classifier, which is a vocabulary change with a real cost of
    // its own — every token added here is a token that can no longer BE a
    // headline, and "Premium Support Lead" is a genuine headline.  The
    // classifiers therefore track the vocabulary this repository's other three
    // extractors already carry rather than growing a private superset.
    const got = fieldsOf(SCRAPE_FEED_SCRIPT, {
      label: "unrecognised badge token",
      href: "/in/ada-lovelace/",
      children: () => bareFields("p", "Ada Lovelace", "• Open to work", "Head of Widgets at Acme", "18h •"),
      name: "Ada Lovelace",
    });

    expect(got.name).toBe("Ada Lovelace");
    expect(got.headline).toBe("• Open to work");
  });

  it("fuses the headline into the name when the slug corroborates BOTH IN FULL and no badge separates them", () => {
    // `/in/ada-lovelace-consulting/` squashes to `adalovelaceconsulting`, which
    // the first TWO fields explain IN FULL, so the name read consumes both and
    // the headline has no field left to be found in.
    //
    // "In full" is what makes this the residue rather than the whole family.
    // An independent differential found the unbounded version of this — a slug
    // whose tail merely STARTS the next field, "Photography & Video" under
    // `/in/john-smith-photography/` — and that is a regression against the
    // pre-#860 read, not a cost: no reader attributes it to a display name.
    // `MAX_NAME_TAIL` bounds it, and the third assertion below is that bound.
    //
    // What is left is genuinely undecidable from the DOM: two runs reading
    // "Ada Lovelace" / "Consulting" are structurally identical to a display
    // name split across two runs — the very shape #860 asks to fuse — and the
    // slug, the only extra evidence, points at the fusion.
    const fused = fieldsOf(SCRAPE_FEED_SCRIPT, {
      label: "slug spans name and headline, no badge between",
      href: "/in/ada-lovelace-consulting/",
      children: () => bareFields("p", "Ada Lovelace", "Consulting", "18h •"),
      name: "Ada Lovelace Consulting",
    });

    expect(fused.name).toBe("Ada Lovelace Consulting");
    expect(fused.headline).toBeNull();

    // The falsifier, asserted rather than asserted-about: put the connection
    // badge back between the two fields — the shape every actor header
    // observed so far actually renders — and the same slug reads correctly.
    // That is what bounds the cost to anchors rendering no badge at all.
    const separated = fieldsOf(SCRAPE_FEED_SCRIPT, {
      label: "same slug, badge between name and headline",
      href: "/in/ada-lovelace-consulting/",
      children: () => bareFields("p", "Ada Lovelace", "• 1st", "Consulting", "18h •"),
      name: "Ada Lovelace",
    });

    expect(separated.name).toBe("Ada Lovelace");
    expect(separated.headline).toBe("Consulting");

    // And the bound itself: the SAME shape, no badge, but a second field the
    // slug only partly accounts for is NOT fused.  This is the assertion that
    // fails if `MAX_NAME_TAIL` is ever widened back into the regression.
    const bounded = fieldsOf(SCRAPE_FEED_SCRIPT, {
      label: "eponymous slug, second field only partly corroborated",
      href: "/in/john-smith-photography/",
      children: () => bareFields("p", "John Smith", "Photography & Video", "2h •"),
      name: "John Smith",
    });

    expect(bounded.name).toBe("John Smith");
    expect(bounded.headline).toBe("Photography & Video");
  });

  it("drops a genuine headline that OPENS with a time-like token", () => {
    // `FIELD_TIMESTAMP` matches a field BEGINNING with a relative-time token
    // followed by whitespace, which a real headline can do: "3d printing
    // specialist" opens `3d` + a space. The headline loop skips every field the
    // classifier claims, so the headline is lost and this shape reports null.
    // The pre-#860 script read it correctly off `pEls[2]`, so this is a
    // regression rather than a pre-existing cost.
    //
    // Left rather than fixed, deliberately, and this is the reasoning so a
    // later reader can overturn it with evidence rather than re-derive it. The
    // narrow fix -- require the token to be the WHOLE field for the headline
    // exclusion -- trades this shape for a field like "18h • Edited", which
    // would stop being excluded and become the headline instead. BOTH shapes
    // are unobserved: this repository holds no captured feed markup at all
    // (#897), and its two legacy post captures were searched and contain no
    // relative-time field of any form. `FIELD_TIMESTAMP` also drives the
    // timestamp READ, which `mapRawPosts` shares with `searchPosts` and
    // `getProfileActivity`, so guessing here risks three operations' timestamps
    // to fix one operation's headline. Tracked for a capture-backed decision.
    const got = fieldsOf(SCRAPE_FEED_SCRIPT, {
      label: "headline opening with a time-like token",
      href: "/in/ada-lovelace/",
      children: () => bareFields("p", "Ada Lovelace", "• 1st", "3d printing specialist", "18h •"),
      name: "Ada Lovelace",
    });

    expect(got.name).toBe("Ada Lovelace");
    expect(got.headline).toBeNull();
    // The timestamp is unaffected: its loop scans backwards and reaches the
    // real time field first, so only the headline pays this cost.
    expect(got.timestamp).toBe("18h");
  });
});
