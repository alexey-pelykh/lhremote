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
| Entity cardinality (comment count, `[data-id^="urn:li:"]` count) | Post and comment prose → deterministic lorem of the same length and word count |
| `urn:li:{type}:` prefixes and shape, including the type name (`fsd_profile`) | URN ids → a synthetic token of the **same length and shape**: digits stay digits, opaque alphanumerics stay opaque. Covers percent-encoded forms (`urn%3Ali%3A…`) in href query strings. |
| Presence/absence of the variant anchors (`[componentkey]`, `[data-testid]`) | Every `*.licdn.com` asset → `https://example.invalid/asset` |

`<script>` and `<style>` **elements are kept** and only their payloads emptied — a selector count
that changed because an element was deleted would be a fixture bug, not a variant flip.

Counts are deliberately **not** scrubbed. A fixture whose counts were anonymised could not exercise
the corroborator it exists to test: the whole point of `post-with-comments` is a cardinal that
contradicts an empty list.

## The fixtures

| File | Variant | Role |
|---|---|---|
| `legacy/post-with-comments.html` | legacy | **Contradiction case.** `socialCounts` says `41 comments` and 40 comment entities are present. If a scrape returns an empty list beside that cardinal, the corroborator must throw. |
| `legacy/post-zero-comments.html` | legacy | **Legal-empty control.** Container matched, post text present, genuinely zero engagement, and *no* cardinal contradicting it. Must return normally and must never throw. |

Each `.html` ships a `.measured.json` sidecar recording what was measured on the live page
**before** scrubbing — the selector counts, the raw `socialCounts` text, and the variant anchors.
That sidecar is the fixture's own provenance: an assertion should agree with it, and a
disagreement means the scrub changed structure it was not supposed to touch.

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

## Privacy

Source pages carry real third-party names, profile URLs, headlines and comment text, and this
repository is public. Scrubbing is part of the capture, not cleanup afterwards.

The harvester is **fail-closed**, with two independent gates, and it **refuses to write** if
either trips — naming each survivor and where it lives:

- a **name** gate over text nodes *and* name-bearing attribute values, flagging capitalised runs
  that are neither LinkedIn UI vocabulary nor the scrubber's own synthetic output;
- an **identifier** gate over the **whole serialised fixture**, flagging any `urn:li:…` token whose
  id is not the synthetic placeholder — encoded or not, whatever the type name.

The two gates read different surfaces on purpose. Every leak found so far got through because a
check read a *narrower* surface than the artifact it certified: the name gate once tag-stripped the
markup and so never saw an attribute, and a real `urn:li:fsd_profile:` account id shipped inside an
`href` query string — a surface the name gate does not read and would not recognise if it did.

That last one was caught in code review, not by this tool, which is the honest state of it: **treat
a green report as a claim, not evidence**, and audit the written file independently — with a
checker that reads the file rather than the DOM — before trusting it.
