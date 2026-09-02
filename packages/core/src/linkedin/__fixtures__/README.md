# LinkedIn DOM fixtures

Captured post-detail markup, reduced to the subtree the adapters read and scrubbed of every
identifying value. They exist so a DOM variant flip is caught **before merge**: per ADR-004 the
Tier-3 E2E suite never runs in CI, so Tier 2 is the only tier that can gate one.

Harvested by `scripts/harvest-dom-fixture.mjs` (scrub logic in `scripts/lib/harvest-scrub.js`)
against a live LinkedHelper session. Re-harvesting requires that session; the script is committed
so the capture is reproducible rather than a one-off artifact of somebody's laptop.

## What is faithful, and what is fake

The fixture's job is to exercise selectors and the corroborator, so the scrub replaces **values**
and never removes or renames an element, a class, or an attribute.

| Preserved exactly | Replaced |
|---|---|
| Element tree, tag names, `class`, `data-*` attribute **names** | Profile slugs → `test-person-N` |
| Engagement counts and the text carrying them (`"2 41 comments"`, `aria-label="2 reactions"`) | Personal names → `Test Person` |
| Entity cardinality (comment count, `[data-id^="urn:li:"]` count) | Post and comment prose → deterministic lorem of the same length and word count, and **every digit inside it → `1`** (a statistics breakdown once survived the word-level sweep intact, because a letterless token has no letter to synthesise) |
| `urn:li:{type}:` prefixes and shape, including the type name (`fsd_profile`) | URN ids → a synthetic token of the **same length and shape**: digits stay digits, opaque alphanumerics stay opaque. Covers percent-encoded forms (`urn%3Ali%3A…`) in href query strings. |
| Presence/absence of the variant anchors (`[componentkey]`, `[data-testid]`) | Every asset URL → an inline 1×1 transparent GIF `data:` URI |
| `w3.org` XML namespaces (inline SVG will not parse without them) and the `/in/` profile-link shape the adapters select on | Every **other** absolute URL → `https://example.invalid/redacted` — shortlinks, opaque `/services/page/{id}` links, anything outbound |

`<script>` and `<style>` **elements are kept** and only their payloads emptied — a selector count
that changed because an element was deleted would be a fixture bug, not a variant flip.

Counts are deliberately **not** scrubbed. A fixture whose counts were anonymised could not exercise
the corroborator it exists to test: the whole point of `post-with-comments` is a cardinal that
contradicts an empty list.

That is why digit scrubbing is scoped to `.update-components-text` — the body container — rather
than applied to every synthesised text node. A bare `2` in its own text node **is** the reaction
count; the word "reactions" lives in a sibling `aria-label`, so no node-local test can tell it from
a number in prose. Scrubbing digits everywhere rewrote that count to `1` while the `aria-label`
still said `2`, leaving the fixture contradicting its own sidecar. No engagement count lives inside
the body container, so the narrower scope is both sufficient and safe.

## The fixtures

| File | Variant | Role |
|---|---|---|
| `legacy/post-with-comments.html` | legacy | **Contradiction case.** `socialCounts` says `41 comments` and 40 comment entities are present. If a scrape returns an empty list beside that cardinal, the corroborator must throw. |
| `legacy/post-zero-comments.html` | legacy | **Legal-empty control.** Container matched, post text present, genuinely zero engagement, and *no* cardinal contradicting it. Must return normally and must never throw. |

Each `.html` ships a `.measured.json` sidecar recording what was measured on the live page
**before** scrubbing — the selector counts, the raw `socialCounts` text, and the variant anchors.
That sidecar is the fixture's own provenance: an assertion should agree with it, and a
disagreement means the scrub changed structure it was not supposed to touch.

Its schema is `{ label, measured, scrub, remediation? }`. The harvester writes the first three
verbatim from the scrub run, so `scrub` mirrors the gate report field-for-field — including the
empty arrays, which is the point: an absent gate field and a gate that found nothing are different
claims, and only one of them is evidence.

`remediation` is **optional and present only on a fixture that was post-processed after its
harvest** — the harvester never emits it. It exists so that a file which is no longer purely the
output of one harvest run says so, rather than presenting itself as one. A consumer should treat
its absence as "this file is exactly what the harvester wrote".

The two are a **pair and must stay one**. Optimising for the contradiction case alone yields
always-throw-on-empty, which destroys a legal outcome; optimising for the control alone restores
the silent-empty defect. Per the PRD's NFR-2/NFR-3 they are satisfied jointly or not at all.

## Not captured, and why

- **`legacy/post-image-only.html`** — no candidate exists. Every post on the capturing account
  carries 1,275–2,270 characters of body text (four are text **plus** image, which is not the same
  shape). Harvesting a third party's post would put someone else's content in a public repo and
  was outside the item's selection; fabricating one would make the oracle tautological — it would
  assert against markup written to satisfy it.
- **`sdui/post-with-comments.html`** — not harvestable at capture time. LinkedIn currently serves
  **legacy** markup on post-detail, which is the defect under repair. The dialect split is
  per-surface: the *feed* was simultaneously serving SDUI (`[componentkey]` present, and no
  `urn:li:activity` anywhere on the page), so an SDUI capture is available from a different
  surface — a separate question from this fixture set.

Both are recorded rather than approximated: a fixture that does not come off a real page cannot
witness a variant flip, which is the only thing these files are for.

## No network

These fixtures load with **zero outbound requests**, which the Tier-2 suite depends on.

Every asset is an inline 1×1 transparent GIF `data:` URI rather than a placeholder URL. An
unresolvable host like `example.invalid` is *not* good enough: the browser still attempts the
lookup, so a fixture with 50 images turns into 50 DNS queries and the suite's "no network" property
quietly becomes "the network fails fast enough". The `data:` URI removes the request entirely.

This is **enforced by the network gate**, not just documented — a future edit that reintroduces a
fetchable URL fails the harvest rather than silently costing the suite its offline guarantee.

`href` is not on the fetch-triggering attribute list, and that exemption is scoped to `<a>`, where
an href is navigation rather than a fetch and carries structure the adapters select on. It does
**not** generalise: `<link href>` fetches a stylesheet and SVG `<image>`/`<use> href` fetches a
resource. A non-anchor `href` is therefore neutralised to the inline asset and checked by the same
gate — redacting it to a placeholder URL would not be enough, for the same reason a placeholder was
not enough for `<img src>`.

## Privacy

Source pages carry real third-party names, profile URLs, headlines and comment text, and this
repository is public. Scrubbing is part of the capture, not cleanup afterwards.

The harvester is **fail-closed**. It **refuses to write** if any of these gates trips, naming each
survivor and where it lives:

- a **name** gate over text nodes *and* name-bearing attribute values, flagging capitalised runs
  that are neither LinkedIn UI vocabulary nor the scrubber's own synthetic output;
- an **identifier** gate over the **whole serialised fixture**, flagging any `urn:li:…` token whose
  id is not the synthetic placeholder — encoded or not, whatever the type name;
- a **network** gate, flagging any dereferenceable `http(s):` URL left in an attribute the browser
  actually fetches (`src`, `srcset`, `poster`, `data-*-url`);
- a **URL** gate, flagging any absolute URL anywhere in the artifact that is not one of the two
  structurally required forms or the redaction placeholder;
- a **numeric** gate, flagging any digit other than `1` left inside a body-text container — real
  statistics, a year, an id or a phone number would all land there, and the marker digit is what
  makes the scrubber's own output distinguishable from a survivor.

URL handling is an **allowlist**, which is the point: a denylist of known-bad hosts was fail-open
and left real trackable URLs in `href` attributes — an opaque `/services/page/{id}` link and
`lnkd.in` shortlinks lifted from the post body. Only two forms survive, each because the fixture
stops working without it, and a `/in/` slug that the slug map somehow missed is forced synthetic
rather than trusted.

The gates read different surfaces on purpose. Every leak found so far got through because a
check read a *narrower* surface than the artifact it certified: the name gate once tag-stripped the
markup and so never saw an attribute, and a real `urn:li:fsd_profile:` account id shipped inside an
`href` query string — a surface the name gate does not read and would not recognise if it did.

That last one was caught in code review, not by this tool, which is the honest state of it: **treat
a green report as a claim, not evidence**, and audit the written file independently — with a
checker that reads the file rather than the DOM — before trusting it.
