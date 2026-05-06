// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Spike: comment-DOM regression probe (#776)
 *
 * Probes the LinkedIn post detail page DOM to discover the new selector
 * shape for comment articles after the regression observed in LH 2.113.61
 * E2E runs (`Timed out waiting for element "article.comments-comment-entity"`
 * and `article[data-id="urn:li:comment:..."]`).
 *
 * The historical contract (research/linkedin/post-detail-comment-dom-20260409.md)
 * was:
 *   <article class="comments-comment-entity"
 *            data-id="urn:li:comment:(activity:<postId>,<commentId>)">
 *
 * This spike navigates to the test post URL and enumerates plausible new
 * shapes:
 *   - Any `article` element on the page (count + class + data-id sample)
 *   - Elements with `data-id` containing `urn:li:comment` (any tag)
 *   - Elements with class names containing `comment` (sample classes)
 *   - Specific selector existence checks
 *
 * Output is logged as JSON; the spike intentionally has no hard
 * assertions on selector content — it documents reality.
 */

import { afterAll, beforeAll, expect, it } from "vitest";
import {
  describeE2E,
  forceStopInstance,
  getE2EPostUrl,
  launchApp,
  quitApp,
  resolveAccountId,
  retryAsync,
} from "@lhremote/core/testing";
import {
  type AppService,
  CDPClient,
  delay,
  discoverInstancePort,
  discoverTargets,
  LauncherService,
  startInstanceWithRecovery,
} from "@lhremote/core";

/** Navigate the LinkedIn target and wait for the load event. */
async function navigateAndWait(client: CDPClient, url: string): Promise<void> {
  await client.send("Page.enable");
  try {
    const loadPromise = client.waitForEvent("Page.loadEventFired", 30_000);
    await client.navigate(url);
    await loadPromise;
  } finally {
    await client.send("Page.disable").catch(() => {});
  }
}

interface ProbeResult {
  /** Total `<article>` elements on the page. */
  totalArticles: number;
  /** Up to 5 article snapshots with class + data-id + first 200 chars. */
  articleSamples: Array<{
    className: string;
    dataId: string | null;
    role: string | null;
    htmlPreview: string;
  }>;
  /** Tags found with `data-id` containing `urn:li:comment`. */
  commentDataIdElements: Array<{
    tag: string;
    className: string;
    dataId: string;
    role: string | null;
  }>;
  /** Tags found with class names containing the substring "comment". */
  classNameContainsComment: Array<{
    tag: string;
    className: string;
  }>;
  /** Existence checks for the selectors lhremote relies on. */
  selectorChecks: Record<string, number>;
}

describeE2E("comment-dom regression probe (#776)", () => {
  let app: AppService;
  let port: number;
  let accountId: number;
  let client: CDPClient;
  let postUrl: string;

  beforeAll(async () => {
    postUrl = getE2EPostUrl();

    const launched = await launchApp();
    app = launched.app;
    port = launched.port;

    accountId = await resolveAccountId(port);

    const launcher = new LauncherService(port);
    await retryAsync(() => launcher.connect(), { retries: 3, delay: 1_000 });
    await startInstanceWithRecovery(launcher, accountId, port);
    launcher.disconnect();

    const instancePort = await retryAsync(
      async () => {
        const p = await discoverInstancePort(port);
        if (p === null) throw new Error("Instance CDP port not discovered yet");
        return p;
      },
      { retries: 10, delay: 2_000 },
    );

    const liTarget = await retryAsync(
      async () => {
        const t = await discoverTargets(instancePort);
        const li = t.find(
          (tgt) => tgt.type === "page" && tgt.url?.includes("linkedin.com"),
        );
        if (!li) throw new Error("LinkedIn target not found yet");
        return li;
      },
      { retries: 30, delay: 2_000 },
    );

    client = new CDPClient(instancePort);
    await client.connect(liTarget.id);

    await navigateAndWait(client, postUrl);
    // Comments section is lazy-hydrated: wait long enough for it to mount.
    await delay(15_000);
  }, 180_000);

  afterAll(async () => {
    client?.disconnect();

    const launcher = new LauncherService(port);
    try {
      await launcher.connect();
      await forceStopInstance(launcher, accountId, port);
    } catch {
      // Best-effort cleanup
    } finally {
      launcher.disconnect();
    }

    await quitApp(app);
  }, 60_000);

  it("dumps article + comment DOM shape (#776)", async () => {
    // Page-state probe: verify we actually navigated where we think we did,
    // not into a login wall / interstitial.
    const pageState = await client.evaluate<{
      url: string;
      title: string;
      bodyChildCount: number;
      bodyChildTags: string[];
      hasLoginForm: boolean;
      hasMain: boolean;
      mainChildren: number;
    }>(`(() => {
      const body = document.body;
      const childTags = Array.from(body.children).map(c => c.tagName + (c.id ? '#' + c.id : ''));
      return {
        url: location.href,
        title: document.title,
        bodyChildCount: body.children.length,
        bodyChildTags: childTags.slice(0, 30),
        hasLoginForm: !!document.querySelector('form[action*="login"], input[name="session_password"]'),
        hasMain: !!document.querySelector('main'),
        mainChildren: document.querySelector('main')?.children.length ?? 0,
      };
    })()`);
    console.log("\n[#776] === page state ===\n" + JSON.stringify(pageState, null, 2));

    const result = await client.evaluate<ProbeResult>(`(() => {
      const allArticles = Array.from(document.querySelectorAll('article'));
      const articleSamples = allArticles.slice(0, 5).map(el => ({
        className: el.className || '',
        dataId: el.getAttribute('data-id'),
        role: el.getAttribute('role'),
        htmlPreview: (el.outerHTML || '').slice(0, 200),
      }));

      const commentDataIdElements = Array
        .from(document.querySelectorAll('[data-id]'))
        .filter(el => {
          const v = el.getAttribute('data-id') || '';
          return v.indexOf('urn:li:comment') !== -1;
        })
        .slice(0, 10)
        .map(el => ({
          tag: el.tagName,
          className: el.className || '',
          dataId: el.getAttribute('data-id') || '',
          role: el.getAttribute('role'),
        }));

      const classNameContainsComment = Array
        .from(document.querySelectorAll('[class*="comment"]'))
        .filter(el => {
          const cls = el.className || '';
          return /comment(s|-)/i.test(cls);
        })
        .slice(0, 30)
        .map(el => ({ tag: el.tagName, className: el.className || '' }));

      const selectorChecks = {
        'article.comments-comment-entity':
          document.querySelectorAll('article.comments-comment-entity').length,
        'article[data-id^="urn:li:comment:"]':
          document.querySelectorAll('article[data-id^="urn:li:comment:"]').length,
        'article[data-id*="urn:li:comment"]':
          document.querySelectorAll('article[data-id*="urn:li:comment"]').length,
        '[data-id^="urn:li:comment:"]':
          document.querySelectorAll('[data-id^="urn:li:comment:"]').length,
        '[data-urn^="urn:li:comment"]':
          document.querySelectorAll('[data-urn^="urn:li:comment"]').length,
        'article[class*="comments-comment"]':
          document.querySelectorAll('article[class*="comments-comment"]').length,
        '[class*="comments-comment-entity"]':
          document.querySelectorAll('[class*="comments-comment-entity"]').length,
        'div[data-id*="urn:li:comment"]':
          document.querySelectorAll('div[data-id*="urn:li:comment"]').length,
        '.comments-comments-list':
          document.querySelectorAll('.comments-comments-list').length,
        '.feed-shared-update-v2':
          document.querySelectorAll('.feed-shared-update-v2').length,
        '[data-id*="urn:li:fsd_comment"]':
          document.querySelectorAll('[data-id*="urn:li:fsd_comment"]').length,
        'div[class*="UpdateV2"]':
          document.querySelectorAll('div[class*="UpdateV2"]').length,
        'div[class*="commentary"]':
          document.querySelectorAll('div[class*="commentary"]').length,
      };

      return {
        totalArticles: allArticles.length,
        articleSamples,
        commentDataIdElements,
        classNameContainsComment,
        selectorChecks,
      };
    })()`);

    console.log("\n[#776] === post-detail comment-DOM probe ===\n" + JSON.stringify(result, null, 2));

    // If we got 0 articles, dump more info: maybe LH webview redirected
    // somewhere, page is empty, or we're behind a guard.  Log without failing
    // so the diagnostic block is preserved when the spike is iterated.
    if (result.totalArticles === 0) {
      const broader = await client.evaluate<unknown>(`(() => ({
        // First 2000 chars of body innerHTML so we can eyeball the page.
        bodyHtmlSample: (document.body.innerHTML || '').slice(0, 2000),
        // Anything resembling a comment URN anywhere in markup.
        urnSample: ((document.body.innerHTML || '').match(/urn:li:[a-z_]+:[^\\s"'<>]{0,80}/g) || []).slice(0, 10),
        // Distinct top-level data-* attributes we see.
        dataAttrs: (() => {
          const seen = new Set();
          for (const el of document.querySelectorAll('*')) {
            for (const a of el.attributes) {
              if (a.name.startsWith('data-')) seen.add(a.name);
              if (seen.size > 80) break;
            }
            if (seen.size > 80) break;
          }
          return Array.from(seen).slice(0, 80);
        })(),
      }))()`);
      console.log("\n[#776] === broad page probe (zero-article fallback) ===\n" + JSON.stringify(broader, null, 2));
    }

    // Targeted hunt for comment containers: walk every element that has any
    // attribute or attribute name containing a comment URN substring, and
    // record the host element's tag + a sample of its attributes.  Then walk
    // up 3 levels to identify likely outer "comment article" containers
    // (often the parent that holds the whole comment block).
    const commentHunt = await client.evaluate<unknown>(`(() => {
      function collectAttrs(el) {
        const out = {};
        for (const a of el.attributes) out[a.name] = a.value.slice(0, 120);
        return out;
      }
      function ancestorChain(el, depth) {
        const chain = [];
        let cur = el;
        for (let i = 0; i <= depth && cur; i++) {
          chain.push({
            tag: cur.tagName,
            id: cur.id || null,
            classNames: (cur.className || '').toString().slice(0, 200),
            dataComponentType: cur.getAttribute && cur.getAttribute('data-component-type'),
            dataTestId: cur.getAttribute && cur.getAttribute('data-testid'),
            dataExpanded: cur.getAttribute && cur.getAttribute('data-expanded'),
          });
          cur = cur.parentElement;
        }
        return chain;
      }

      // 1. Elements where ANY attribute value contains a comment URN.
      const urnHosts = [];
      const seen = new WeakSet();
      for (const el of document.querySelectorAll('*')) {
        if (urnHosts.length >= 8) break;
        if (seen.has(el)) continue;
        for (const a of el.attributes) {
          if (a.value && a.value.indexOf('urn:li:comment') !== -1) {
            seen.add(el);
            urnHosts.push({
              attr: a.name,
              attrValuePreview: a.value.slice(0, 150),
              tag: el.tagName,
              classNames: (el.className || '').toString().slice(0, 200),
              ancestorChain: ancestorChain(el, 5),
            });
            break;
          }
        }
      }

      // 2. Elements whose id is or starts with a comment URN.
      const idHosts = Array.from(document.querySelectorAll('[id]'))
        .filter(el => el.id.indexOf('urn:li:comment') !== -1)
        .slice(0, 5)
        .map(el => ({ tag: el.tagName, id: el.id, classNames: (el.className || '').toString().slice(0, 200) }));

      // 3. Look at <main> and its descendants for the most-likely comment region.
      const main = document.querySelector('main');
      const mainChildSummary = main
        ? Array.from(main.children).slice(0, 5).map(c => ({
            tag: c.tagName,
            classNames: (c.className || '').toString().slice(0, 200),
            childCount: c.children.length,
            dataComponentType: c.getAttribute('data-component-type'),
          }))
        : null;

      // 4. Count the SDUI-shaped elements — new React stack uses these.
      const sduiCounts = {
        '[data-component-type]': document.querySelectorAll('[data-component-type]').length,
        '[data-sdui-screen]': document.querySelectorAll('[data-sdui-screen]').length,
        '[data-testid]': document.querySelectorAll('[data-testid]').length,
        '[data-expanded]': document.querySelectorAll('[data-expanded]').length,
        '[data-display-contents]': document.querySelectorAll('[data-display-contents]').length,
      };

      // 5. Distinct data-component-type values observed.
      const componentTypes = (() => {
        const set = new Set();
        for (const el of document.querySelectorAll('[data-component-type]')) {
          set.add(el.getAttribute('data-component-type'));
          if (set.size > 40) break;
        }
        return Array.from(set);
      })();

      // 6. Distinct data-testid values that hint at comments.
      const commentTestIds = (() => {
        const set = new Set();
        for (const el of document.querySelectorAll('[data-testid]')) {
          const v = el.getAttribute('data-testid') || '';
          if (/comment|reply/i.test(v)) set.add(v);
          if (set.size > 30) break;
        }
        return Array.from(set);
      })();

      return {
        urnHosts,
        idHosts,
        mainChildSummary,
        sduiCounts,
        componentTypes,
        commentTestIds,
      };
    })()`);
    console.log("\n[#776] === comment hunt ===\n" + JSON.stringify(commentHunt, null, 2));

    // Inner-button probe: pick the first visible comment article (by
    // componentkey), enumerate every <button> inside it, and dump the
    // shape — tag, classNames, aria-label, type.  Goal: discover the
    // new aria-label patterns for the comment's Reply / React Like /
    // reactions menu buttons, since the legacy `aria-label^="Reply to "`
    // and `aria-label^="React Like to "` selectors timeout against the
    // SDUI comment DOM (lhremote#776 follow-up).
    const buttonHunt = await client.evaluate<unknown>(`(() => {
      // Pick the OUTERMOST componentkey wrapper for the first comment.
      // Multiple nested elements share the same componentkey value;
      // querySelectorAll returns them in document order (outermost first
      // by structural position, but several inner wrappers also share
      // the key — there is no positional guarantee that any single index
      // is the outer one).  Use a max-descendants heuristic: the outer
      // wrapper contains the most descendant elements.
      const all = Array.from(document.querySelectorAll('[componentkey^="replaceableComment_"]'));
      if (all.length === 0) return { error: 'no comment articles found' };

      let outer = all[0];
      let maxDescendants = outer.querySelectorAll('*').length;
      for (const el of all) {
        const n = el.querySelectorAll('*').length;
        if (n > maxDescendants) {
          outer = el;
          maxDescendants = n;
        }
      }

      const componentkey = outer.getAttribute('componentkey');

      // Enumerate ALL buttons under this comment.
      const buttons = Array.from(outer.querySelectorAll('button')).map(b => ({
        tag: b.tagName,
        type: b.getAttribute('type'),
        ariaLabel: b.getAttribute('aria-label'),
        ariaPressed: b.getAttribute('aria-pressed'),
        ariaExpanded: b.getAttribute('aria-expanded'),
        textContentTrimmed: (b.textContent || '').trim().slice(0, 60),
        dataTestId: b.getAttribute('data-testid'),
        classNamesPreview: (b.className || '').toString().slice(0, 80),
      }));

      // Also enumerate elements with role="button" that aren't <button>.
      const roleButtons = Array.from(outer.querySelectorAll('[role="button"]'))
        .filter(b => b.tagName !== 'BUTTON')
        .map(b => ({
          tag: b.tagName,
          ariaLabel: b.getAttribute('aria-label'),
          textContentTrimmed: (b.textContent || '').trim().slice(0, 60),
          classNamesPreview: (b.className || '').toString().slice(0, 80),
        }));

      // Image/svg elements with aria-label or alt for action icons.
      const labeledIcons = Array.from(outer.querySelectorAll('[aria-label]'))
        .filter(el => el.tagName !== 'BUTTON' && el.getAttribute('role') !== 'button')
        .slice(0, 10)
        .map(el => ({
          tag: el.tagName,
          ariaLabel: el.getAttribute('aria-label'),
          textContentTrimmed: (el.textContent || '').trim().slice(0, 60),
        }));

      return {
        commentKey: componentkey,
        descendantCount: maxDescendants,
        buttonCount: buttons.length,
        buttons: buttons.slice(0, 30),
        roleButtonCount: roleButtons.length,
        roleButtons: roleButtons.slice(0, 10),
        labeledIcons,
      };
    })()`);
    console.log("\n[#776] === inner-button hunt ===\n" + JSON.stringify(buttonHunt, null, 2));

    // Reactions popup probe: click "Open reactions menu" on the first
    // visible comment, dump the popup buttons, then press Escape to
    // close.  Read-only with respect to the comment's reaction state —
    // the popup must be opened to inspect, but Escape dismisses it
    // without applying any reaction.
    // First, confirm by hover (not click) — post-level react-to-post.ts
    // uses humanizedHover to open the menu.  After hovering, scan the
    // entire page for buttons with aria-label "Like" / "React Like" /
    // "Celebrate" / etc. — these are the post-level popup buttons that
    // the comment menu likely shares.
    const reactionPopupProbe = await client.evaluate<unknown>(`(async () => {
      const all = Array.from(document.querySelectorAll('[componentkey^="replaceableComment_"]'));
      let outer = all[0];
      let max = outer ? outer.querySelectorAll('*').length : 0;
      for (const el of all) {
        const n = el.querySelectorAll('*').length;
        if (n > max) { outer = el; max = n; }
      }
      if (!outer) return { error: 'no comment found' };

      const menuBtn = outer.querySelector('button[aria-label="Open reactions menu"]');
      if (!menuBtn) return { error: 'no reactions menu button found in comment' };

      const REACTION_NAMES = ['Like', 'Celebrate', 'Support', 'Love', 'Insightful', 'Funny'];
      function findReactionButtons() {
        return REACTION_NAMES.map(name => {
          // Try multiple selectors per name and pick the first visible.
          const selectors = [
            'button[aria-label="' + name + '"]',
            'button[aria-label="React ' + name + '"]',
            'button[aria-label^="React ' + name + ' "]',
            'button[aria-label^="' + name + ' "]',
          ];
          for (const sel of selectors) {
            const els = document.querySelectorAll(sel);
            for (const el of els) {
              const r = el.getBoundingClientRect();
              if (r.width > 0 && r.height > 0) {
                return { name, selector: sel, ariaLabel: el.getAttribute('aria-label'), w: r.width, h: r.height };
              }
            }
          }
          return { name, selector: null };
        });
      }

      const before = findReactionButtons();

      // Try CLICK first.
      menuBtn.click();
      await new Promise(r => setTimeout(r, 800));
      const afterClick = findReactionButtons();

      // Try simulated mouse events for HOVER (move into the menu button).
      const r = menuBtn.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      menuBtn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: x, clientY: y }));
      menuBtn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: x, clientY: y }));
      menuBtn.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: x, clientY: y }));
      menuBtn.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true, clientX: x, clientY: y }));
      await new Promise(res => setTimeout(res, 1500));
      const afterHover = findReactionButtons();

      // Press Escape to close any popup.
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, keyCode: 27 }));
      await new Promise(res => setTimeout(res, 500));

      // Also scan the role="button" reaction-state element near this comment
      // — see if clicking IT might work as an alternative entry point.
      const stateEls = Array.from(outer.querySelectorAll('[role="button"]'))
        .filter(el => /Reaction button state/.test(el.textContent || ''))
        .map(el => ({
          tag: el.tagName,
          textPreview: (el.textContent || '').slice(0, 60),
          ariaLabel: el.getAttribute('aria-label'),
          ariaPressed: el.getAttribute('aria-pressed'),
        }));

      return {
        before,
        afterClick,
        afterHover,
        stateEls,
      };
    })()`, true);
    console.log("\n[#776] === reactions popup probe ===\n" + JSON.stringify(reactionPopupProbe, null, 2));

    // Soft assertion: don't fail the spike on the zero-articles case;
    // the diagnostic logs above are the deliverable.
    expect(typeof result.selectorChecks).toBe("object");
  }, 90_000);
});
