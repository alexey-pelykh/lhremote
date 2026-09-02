// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

// In-page scrub source for scripts/harvest-dom-fixture.mjs.
//
// Kept in its OWN file, read verbatim and evaluated in the page, rather than
// embedded as a template literal in the caller: inside a template literal every
// backslash needs doubling, and a single missed one silently truncates a regex
// literal.  Here the code is ordinary JavaScript and means what it says.
//
// Contract: evaluates to
//   { error, measured, scrub, html, blocked }
(() => {
  const post = document.querySelector('.feed-shared-update-v2');
  if (!post) {
    return { error: 'NO_LEGACY_POST_CONTAINER', href: location.href,
      componentkey: document.querySelectorAll('[componentkey]').length };
  }

  // Measured BEFORE scrubbing: these are what the oracle asserts, recorded as
  // provenance rather than recomputed from the scrubbed artefact.
  const measured = {
    href: location.href,
    updateComponentsText: document.querySelectorAll('.update-components-text').length,
    dataIdUrn: document.querySelectorAll('[data-id^="urn:li:"]').length,
    commentEntities: document.querySelectorAll('article.comments-comment-entity').length,
    socialCounts: document.querySelectorAll('.social-details-social-counts').length,
    socialCountsText: (document.querySelector('.social-details-social-counts') || {}).textContent
      ? document.querySelector('.social-details-social-counts').textContent.replace(/\s+/g, ' ').trim()
      : '',
    reactionsTriggerAria: document.querySelector('button[data-reaction-details]')
      ? document.querySelector('button[data-reaction-details]').getAttribute('aria-label') : null,
    componentkey: document.querySelectorAll('[componentkey]').length,
    dataTestid: document.querySelectorAll('[data-testid]').length,
    sduiScreen: document.querySelectorAll('[data-sdui-screen]').length,
    feedSharedUpdate: document.querySelectorAll('.feed-shared-update-v2').length,
  };

  // Detached deep clone -- the live page is never mutated.
  const root = post.cloneNode(true);
  const doc = document;
  const report = { slugs: 0, names: 0, images: 0, urns: 0, textNodes: 0 };

  // 1. Identity map: real profile slug -> synthetic.
  const slugMap = new Map();
  const slugRe = /\/in\/([^/?#"']+)/;
  for (const a of root.querySelectorAll('a[href*="/in/"]')) {
    const m = slugRe.exec(a.getAttribute('href') || '');
    if (!m) continue;
    if (!slugMap.has(m[1])) slugMap.set(m[1], 'test-person-' + (slugMap.size + 1));
  }

  // 2. Count-bearing text is PRESERVED -- the corroborator asserts on it, so a
  //    fixture with scrubbed counts could not exercise the contract it exists for.
  const COUNT_RE = /\d[\d,]*\s*(reaction|comment|repost|share|follower|view|impression)/i;
  const isCountBearing = (s) => COUNT_RE.test(s);

  // 3. Deterministic word-for-word substitution: same length and same word
  //    count, no real content.  Punctuation is NOT preserved -- a token is
  //    replaced whole, so an embedded comma or period goes with it.  Length and
  //    word count are what the fixture needs (they drive layout and text-node
  //    splitting); punctuation is not asserted on anywhere.
  const VOCAB = ('lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor '
    + 'incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation '
    + 'ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit '
    + 'voluptate velit esse cillum eu fugiat nulla pariatur excepteur sint occaecat cupidatat non '
    + 'proident sunt culpa qui officia deserunt mollit anim id est laborum').split(' ');
  let wordCursor = 0;
  // Every word this emits is recorded.  The residual gate below consults the
  // record instead of trying to guess which padded forms ('Fugiatx', 'Inxxxxx')
  // are synthetic: length-matching mangles the vocabulary, so a fixed allowlist
  // would flag the scrubber's own output as suspected identities.
  const emitted = new Set();
  const synthWord = (w) => {
    if (!/[A-Za-zÀ-ɏ]/.test(w)) return w;
    const pick = VOCAB[wordCursor++ % VOCAB.length];
    let out = pick.length >= w.length ? pick.slice(0, w.length)
                                      : pick + 'x'.repeat(w.length - pick.length);
    if (/^[A-Z]/.test(w)) out = out.charAt(0).toUpperCase() + out.slice(1);
    emitted.add(out);
    return out;
  };
  const synthText = (str) => str.split(/(\s+)/)
    .map((t) => (/^\s+$/.test(t) ? t : synthWord(t))).join('');

  // LinkedIn's own UI vocabulary plus this scrubber's synthetic output.  Declared
  // here rather than at the gate because BOTH the replacement sweep below and the
  // gate consult it -- the two must share one allowlist or they disagree.
  const UI_VOCAB = new Set(('Test Person View Like Likes Celebrate Support Love Insightful Funny '
    + 'Dismiss Reply Replies Follow Following Unfollow Premium LinkedIn All Reaction Reactions '
    + 'Feed Open Send Repost Reposts Comment Comments Share Author Status New Show More Loading '
    + 'Image Video Document Photo Post Sponsored Promoted Edited You Message Connect Report Save '
    + 'Copy Link Embed Why See Translation Original Top Most Relevant Recent Add Profile Company '
    + 'Page Group Newsletter Event Job Skip Main Content Navigation Menu Close Back Next Previous '
    + 'Cancel Done Yes No OK Read Write Article Poll Curious Insight Graphic Anonymous Member '
    + 'Hidden Deleted Unavailable Yesterday Today Now Ago Second Minute Hour Day Week Month Year '
    + 'Emoji Emojis Keyboard Sticker Toolbar Button Toggle Expand Collapse Options Control '
    + 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec Mon Tue Wed Thu Fri Sat Sun '
    + 'Lorem Ipsum Dolor Sit Amet Sed Ut Et Ex Ea In Id Est Do Qui Non Enim Ad Duis Eu Nulla Quis '
    + 'Nisi Aute Irure Esse Velit Cillum Fugiat Sunt Culpa Anim Labore Magna Aliqua Veniam Tempor '
    + 'Elit Adipiscing Consectetur Eiusmod Incididunt Dolore Minim Nostrud Exercitation Ullamco '
    + 'Laboris Aliquip Commodo Consequat Reprehenderit Voluptate Pariatur Excepteur Sint Occaecat '
    + 'Cupidatat Proident Officia Deserunt Mollit Laborum Ipsam').split(/\s+/));

  // Residual-name sweep -- the fail-closed complement to the NAME_SLOT_PATTERNS
  // enumeration in step 5.  An enumeration of name slots fails OPEN: every slot
  // shape nobody thought of ships a real name.  This sweep replaces any
  // capitalised run that is neither UI vocabulary nor this scrubber's own
  // output, whether or not a pattern claimed it.  Over-replacement here costs a
  // mangled a11y string in a fixture; under-replacement ships third-party PII to
  // a public repo, so it is deliberately biased toward replacing.
  //
  // RUNS, not bigrams.  A non-overlapping bigram scan CONSUMES a pair it then
  // skips as UI vocabulary, so it resumes mid-run and re-pairs across the
  // remainder.  That manufactures false positives ("Open Emoji Keyboard" ->
  // the phantom pair "Emoji Keyboard") and, worse, fails OPEN on the case that
  // matters: in "Premium Alexey Pelykh" the skipped pair "Premium Alexey"
  // swallows the given name and leaves the surname unpaired, so a real identity
  // passes clean.
  const RUN_RE = /[A-ZÀ-Þ][\wÀ-ɏ'’-]*(?:\s+[A-ZÀ-Þ][\wÀ-ɏ'’-]*)+/g;
  const isKnown = (w) => UI_VOCAB.has(w) || emitted.has(w);

  // Every maximal sub-run of 2+ adjacent words that are NEITHER UI vocabulary
  // NOR this scrubber's own output.  One function, used by the replacement pass
  // and by the gate below -- two scanners that partition text differently
  // disagree, and the gate is only evidence if it sees what the sweep saw.
  const identityRuns = (str) => {
    const found = [];
    let m;
    RUN_RE.lastIndex = 0;
    while ((m = RUN_RE.exec(str)) !== null) {
      const words = m[0].split(/\s+/);
      let cur = [];
      for (let i = 0; i <= words.length; i++) {
        if (i < words.length && !isKnown(words[i])) { cur.push(words[i]); continue; }
        if (cur.length >= 2) found.push(cur.join(' '));
        cur = [];
      }
    }
    return found;
  };

  // Replace by REGEX over the run's words, never by literal substring.
  // identityRuns NORMALISES a run (it joins the words with a plain space), while
  // the value it came from may separate them with NBSP, a newline, or a double
  // space -- LinkedIn writes "Software&nbsp;Architect".  A literal split() then
  // matches nothing and the run is detected, reported, and silently NOT replaced:
  // fail-open, and invisible because the gate re-normalises and re-reports it as
  // if it were merely unknown vocabulary.
  const escapeRe = (w) => w.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  const sweepNames = (v) => {
    const runs = identityRuns(v);
    let out = v;
    for (let i = 0; i < runs.length; i++) {
      out = out.replace(
        new RegExp(runs[i].split(' ').map(escapeRe).join('\\s+'), 'g'), 'Test Person');
    }
    return out;
  };

  // 4. Text nodes.
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  for (const tn of textNodes) {
    const raw = tn.nodeValue || '';
    if (!raw.trim()) continue;
    if (isCountBearing(raw)) {
      // Preserved verbatim for the corroborator -- but "41 comments on X's post"
      // is count-bearing AND name-bearing, so it still needs the sweep.
      const swept = sweepNames(raw);
      if (swept !== raw) { tn.nodeValue = swept; report.names++; }
      continue;
    }
    tn.nodeValue = synthText(raw);
    report.textNodes++;
  }

  // 5. Attributes.  Name-bearing attributes are scrubbed by PATTERN, never by a
  //    blocklist of collected names: a blocklist fails OPEN, because a name that
  //    appears only in an alt/aria-label -- a reactor facepile link has no text
  //    node at all -- is never collected and survives untouched.  The patterns
  //    keep LinkedIn's structural vocabulary, which selectors key on
  //    (aria-label prefix "Open control menu for post", suffix " All reactions"),
  //    and replace only the name slot inside it.
  const NAME_SLOT_PATTERNS = [
    [/(\bView\s+)[^"]*?(’s|'s)/gi, '$1Test Person$2'],
    [/(\bpost\s+by\s+)[^,"]+/gi, '$1Test Person'],
    [/(\bReply\s+to\s+)[^,"]+/gi, '$1Test Person'],
    [/(\bReact\s+\w+\s+to\s+)[^,"]+/gi, '$1Test Person'],
    [/(\bUnreact\s+\w+\s+(?:to|from)\s+)[^,"]+/gi, '$1Test Person'],
    [/(\bReaction\s+on\s+)[^"]*?(’s|'s)/gi, '$1Test Person$2'],
    [/(\bFollow\s+)[^,"]+/gi, '$1Test Person'],
    [/(\bMessage\s+)[^,"]+/gi, '$1Test Person'],
    [/(\bsee\s+more\s+of\s+)[^,"]+/gi, '$1Test Person'],
    [/(\bto\s+)[^,"]*?(’s|'s)\s+(comment|post)/gi, '$1Test Person$2 $3'],
  ];
  const NAME_ATTRS = ['aria-label', 'alt', 'title', 'aria-description',
    'aria-roledescription', 'data-test-name', 'placeholder'];

  // Attributes a browser DEREFERENCES on load.  `href` is deliberately absent:
  // an <a href> is navigation, not a fetch, and the hrefs carry structure the
  // adapters read.  Everything here is neutralised to an inline asset.
  const FETCHING_ATTRS = ['src', 'srcset', 'poster', 'data-delayed-url',
    'data-ghost-url', 'data-src', 'data-srcset'];
  // URN scrubbing has to cover three axes at once, and the first revision of this
  // missed a real `urn:li:fsd_profile:` identifier on ALL THREE independently:
  // it is PERCENT-ENCODED inside an href query string (`urn%3Ali%3A...`), its
  // type name carries an UNDERSCORE (`fsd_profile`, which `[a-zA-Z]+` rejects),
  // and its id is an OPAQUE alphanumeric token, not digits.  Any one of those
  // alone would have been enough to let it through.
  //
  // The id's SHAPE is preserved -- digits stay digits, opaque stays opaque, and
  // length is kept -- because a selector or parser keying on URN shape must
  // behave the same against the fixture as against the live page.
  const URN_ANY = /urn(:|%3A)li(:|%3A)([a-zA-Z_]+)(:|%3A)([A-Za-z0-9_-]+)/gi;
  const scrubUrn = (whole, s1, s2, type, s3, id) =>
    'urn' + s1 + 'li' + s2 + type + s3
      + (/^[0-9]+$/.test(id) ? '1'.repeat(id.length) : 'A'.repeat(id.length));
  // A 1x1 transparent GIF, inline.  NOT an `https://example.invalid/...`
  // placeholder: `.invalid` never resolves, but the browser still ATTEMPTS the
  // fetch, so loading a fixture would emit ~50 DNS lookups and make a suite
  // advertised as "no network" quietly depend on those lookups failing fast.
  // A data: URI makes the fixture genuinely self-contained.
  const BLANK_ASSET =
    'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  // URL handling is an ALLOWLIST, not a list of known-bad hosts.  A denylist of
  // `licdn.com` + `urn:li:` was fail-open and left real trackable URLs in hrefs:
  // an opaque `linkedin.com/services/page/{id}` and `lnkd.in/{code}` shortlinks
  // out of the post body.  Anything not structurally required is redacted.
  //
  // Exactly two forms survive, both because the fixture STOPS WORKING without
  // them: w3.org XML namespaces, without which the inline SVG does not parse,
  // and linkedin.com/in/ profile links, which the adapters select on
  // (`main a[href*="/in/"]`).  The second is additionally re-checked here rather
  // than trusted -- a `/in/` slug that the slug map missed is a REAL identity,
  // so the path shape is kept while the slug itself is forced synthetic.
  const SAFE_NAMESPACE_URL = /^https?:\/\/(www\.)?w3\.org\//i;
  const LINKEDIN_PROFILE_URL = /^https?:\/\/([a-z0-9-]+\.)*linkedin\.com\/in\//i;
  const REDACTED_URL = 'https://example.invalid/redacted';
  const scrubOtherUrls = (v) => v.replace(/https?:\/\/[^\s"'<>)]+/gi, (u) => {
    if (SAFE_NAMESPACE_URL.test(u)) return u;
    if (LINKEDIN_PROFILE_URL.test(u)) {
      return u.replace(/\/in\/([^/?#]+)/, (seg, slug) =>
        /^test-person-/.test(slug) ? seg : '/in/test-person-x');
    }
    return REDACTED_URL;
  });
  const scrubUrls = (v) => scrubOtherUrls(v
    .replace(/https?:\/\/[a-z0-9.-]*licdn\.com\/[^"'\s)]*/gi, BLANK_ASSET)
    .replace(URN_ANY, scrubUrn));

  // `root` itself is INCLUDED.  querySelectorAll('*') excludes the element it is
  // called on, so scrubbing that set alone left the post container's own
  // attributes untouched while the gate below audited them -- an asymmetry that
  // reads as a vocabulary gap and is actually an unscrubbed element.
  for (const el of [root].concat(Array.prototype.slice.call(root.querySelectorAll('*')))) {
    for (const attr of Array.from(el.attributes || [])) {
      const name = attr.name;
      const before = attr.value;
      let v = before;
      if (!v) continue;

      if (name === 'href' || name === 'xlink:href') {
        const m = slugRe.exec(v);
        if (m && slugMap.has(m[1])) {
          v = v.replace('/in/' + m[1], '/in/' + slugMap.get(m[1]));
          report.slugs++;
        }
      }
      if (FETCHING_ATTRS.indexOf(name) !== -1) {
        v = BLANK_ASSET;
        report.images++;
      }
      if (NAME_ATTRS.indexOf(name) !== -1) {
        for (let i = 0; i < NAME_SLOT_PATTERNS.length; i++) {
          v = v.replace(NAME_SLOT_PATTERNS[i][0], NAME_SLOT_PATTERNS[i][1]);
        }
        v = sweepNames(v);
        if (v !== before) report.names++;
      }
      v = scrubUrls(v);
      if (/^(data-id|data-urn|data-entity-urn|data-chameleon-result-urn)$/.test(name)) {
        // Length-preserving, like scrubUrn above.  A hard-coded 19-digit
        // constant contradicted the stated "shape is kept" contract and
        // silently reshaped any id of a different length.
        const nv = v.replace(/[0-9]{6,}/g, (d) => '1'.repeat(d.length));
        if (nv !== v) report.urns++;
        v = nv;
      }
      if (v !== before) el.setAttribute(name, v);
    }
  }

  // 6. Inert the executable and the bulk payloads.  Elements are KEPT so
  //    structure and selector counts stay faithful; only payloads are emptied.
  const scripts = root.querySelectorAll('script, style');
  for (let i = 0; i < scripts.length; i++) scripts[i].textContent = '';
  const paths = root.querySelectorAll('svg path, svg use, svg image');
  for (let i = 0; i < paths.length; i++) {
    if (paths[i].hasAttribute('d')) paths[i].setAttribute('d', 'M0 0');
  }

  // 7. FAIL-CLOSED residual-identity gate.  A scrub REPORT is not evidence the
  //    scrub worked.  A blocklist can only ever find what was already
  //    enumerated, so the gate is instead a capitalised-run detector measured
  //    against an allowlist of LinkedIn's own UI vocabulary: anything else is
  //    treated as a suspected identity and BLOCKS the write.
  const serialised = root.outerHTML;
  // Corpus = text nodes PLUS name-bearing attribute values.  Tag-stripping the
  // serialisation (the previous corpus) DELETES every attribute, so the gate ran
  // over a partial corpus and its silence was false-absence, not evidence: six
  // aria-label/alt slots carrying a real name passed it clean.  Read the scrubbed
  // tree directly -- it is what gets serialised, so it is the right subject.
  const auditParts = [];
  const auditWalker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (auditWalker.nextNode()) {
    const tv = auditWalker.currentNode.nodeValue || '';
    if (tv.trim()) {
      auditParts.push({ where: 'text<' + (auditWalker.currentNode.parentElement
        ? auditWalker.currentNode.parentElement.tagName.toLowerCase() : '?') + '>', text: tv });
    }
  }
  const auditEls = [root].concat(Array.prototype.slice.call(root.querySelectorAll('*')));
  for (let i = 0; i < auditEls.length; i++) {
    for (let j = 0; j < NAME_ATTRS.length; j++) {
      const av = auditEls[i].getAttribute(NAME_ATTRS[j]);
      if (av) auditParts.push({ where: '@' + NAME_ATTRS[j], text: av });
    }
  }
  // Split, because one number over two different surfaces is not readable: the
  // gate's corpus is text nodes AND attribute values, and a reader checking a
  // sidecar needs to know which surface was thin.  A single `auditedAttrValues`
  // counting both was actively misleading about the attribute coverage that the
  // earlier leaks turned on.
  report.auditedTextNodes = auditParts.filter((x) => x.where.charAt(0) === 't').length;
  report.auditedAttrValues = auditParts.filter((x) => x.where.charAt(0) === '@').length;

  // Each audited value is scanned INDEPENDENTLY.  Joining them into one corpus
  // let a run be manufactured across the seam between two unrelated values.
  // IDENTIFIER gate, over the WHOLE serialised artifact rather than the audited
  // text/attribute subset.  The name gate below reads text nodes and
  // name-bearing attributes; an identifier does not live there.  A real
  // `urn:li:fsd_profile:` id shipped inside an `href` query string precisely
  // because every check in this file read a narrower surface than the file it
  // certified -- the same defect, for the fourth time.  So this one reads the
  // artifact itself, and an id that is not the synthetic placeholder BLOCKS.
  const residualUrns = new Map();
  {
    const re = new RegExp(URN_ANY.source, 'gi');
    let um;
    while ((um = re.exec(serialised)) !== null) {
      const id = um[5];
      if (/^1+$/.test(id) || /^A+$/.test(id)) continue;
      residualUrns.set(um[0].slice(0, 80), (residualUrns.get(um[0].slice(0, 80)) || 0) + 1);
    }
  }
  report.suspectedResidualIds = Array.from(residualUrns.entries())
    .sort((a, b) => b[1] - a[1]).slice(0, 15).map((e) => e[0] + ' x' + e[1]);

  // NETWORK gate.  A fixture for a "no network" tier must not be able to reach
  // the network at all, and that has to be ENFORCED rather than asserted in a
  // README -- otherwise the suite's no-network property silently depends on
  // every future edit remembering it.
  // URL gate.  Absolute URLs are allowlisted, so anything unrecognised in the
  // finished artifact is by definition unscrubbed -- this is what turns the
  // allowlist above from a policy into an enforced one.
  const residualUrls = new Map();
  {
    const re = /https?:\/\/[^\s"'<>)]+/gi;
    let rm;
    while ((rm = re.exec(serialised)) !== null) {
      const u = rm[0];
      if (SAFE_NAMESPACE_URL.test(u)) continue;
      if (u === REDACTED_URL) continue;
      if (LINKEDIN_PROFILE_URL.test(u) && /\/in\/test-person-/.test(u)) continue;
      residualUrls.set(u.slice(0, 70), (residualUrls.get(u.slice(0, 70)) || 0) + 1);
    }
  }
  report.residualUrls = Array.from(residualUrls.entries())
    .sort((a, b) => b[1] - a[1]).slice(0, 12).map((e) => e[0] + ' x' + e[1]);

  const residualFetches = new Map();
  {
    const re = /\s(src|srcset|poster|data-delayed-url|data-ghost-url|data-src|data-srcset)=["']([^"']*)["']/gi;
    let fm;
    while ((fm = re.exec(serialised)) !== null) {
      if (!/^https?:/i.test(fm[2].trim())) continue;
      residualFetches.set(fm[1] + '=' + fm[2].slice(0, 60),
        (residualFetches.get(fm[1] + '=' + fm[2].slice(0, 60)) || 0) + 1);
    }
  }
  report.residualFetchUrls = Array.from(residualFetches.entries())
    .sort((a, b) => b[1] - a[1]).slice(0, 10).map((e) => e[0] + ' x' + e[1]);

  const suspects = new Map();
  // Record WHERE each suspect lives, not just what it is.  A gate that names a
  // token without its context cannot distinguish "the sweep does not reach this
  // surface" from "this is vocabulary the allowlist lacks" -- and those have
  // opposite remedies.
  const suspectContext = new Map();
  for (let i = 0; i < auditParts.length; i++) {
    const runs = identityRuns(auditParts[i].text);
    for (let j = 0; j < runs.length; j++) {
      suspects.set(runs[j], (suspects.get(runs[j]) || 0) + 1);
      if (!suspectContext.has(runs[j])) {
        suspectContext.set(runs[j], auditParts[i].where + ': '
          + auditParts[i].text.slice(0, 160));
      }
    }
  }
  report.suspectedResidualNames = Array.from(suspects.entries())
    .sort((a, b) => b[1] - a[1]).slice(0, 25)
    .map((e) => e[0] + ' x' + e[1] + '  <- ' + (suspectContext.get(e[0]) || '?'));

  return { error: null, measured, scrub: report, html: serialised,
    blocked: report.suspectedResidualNames.length > 0
      || report.suspectedResidualIds.length > 0
      || report.residualFetchUrls.length > 0
      || report.residualUrls.length > 0 };
})()
