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
