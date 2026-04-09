// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Spike: LinkedIn mention autocomplete DOM investigation (#712)
 *
 * This spike navigates to a post page, focuses the comment input, types `@`
 * followed by a search string, and captures the DOM structure of whatever
 * autocomplete/typeahead popup LinkedIn renders. The results are logged to
 * the console for inspection — no comment is submitted.
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
  COMMENT_INPUT,
  delay,
  discoverInstancePort,
  discoverTargets,
  LauncherService,
  startInstanceWithRecovery,
} from "@lhremote/core";

/** Navigate and wait for page load event. */
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

/** Type a single character via CDP key events. */
async function typeChar(client: CDPClient, char: string): Promise<void> {
  await client.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: char,
    text: char,
  });
  await client.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: char,
  });
  await delay(100);
}

/**
 * Broad DOM probe: search for potential autocomplete/mention popup elements
 * using multiple heuristics. Returns a diagnostic object.
 */
async function probeMentionPopup(client: CDPClient): Promise<string> {
  return client.evaluate<string>(
    `(() => {
      const results = [];

      // Heuristic 1: role="listbox" (common for autocomplete dropdowns)
      const listboxes = document.querySelectorAll('[role="listbox"]');
      if (listboxes.length > 0) {
        results.push('=== [role="listbox"] (' + listboxes.length + ' found) ===');
        listboxes.forEach((el, i) => {
          results.push('--- listbox ' + i + ' ---');
          results.push('tagName: ' + el.tagName);
          results.push('className: ' + el.className);
          results.push('id: ' + el.id);
          results.push('aria-label: ' + el.getAttribute('aria-label'));
          results.push('childCount: ' + el.children.length);
          // Capture first 3 children's outer HTML (truncated)
          Array.from(el.children).slice(0, 3).forEach((child, j) => {
            const html = child.outerHTML;
            results.push('child[' + j + ']: ' + html.substring(0, 500));
          });
        });
      }

      // Heuristic 2: role="option" (items inside autocomplete)
      const options = document.querySelectorAll('[role="option"]');
      if (options.length > 0) {
        results.push('=== [role="option"] (' + options.length + ' found) ===');
        options.forEach((el, i) => {
          if (i < 5) {
            results.push('option[' + i + ']: ' + el.outerHTML.substring(0, 400));
          }
        });
      }

      // Heuristic 3: data-testid containing "mention" or "typeahead"
      const mentionEls = document.querySelectorAll(
        '[data-testid*="mention"], [data-testid*="typeahead"], [data-testid*="Mention"], [data-testid*="Typeahead"]'
      );
      if (mentionEls.length > 0) {
        results.push('=== data-testid mention/typeahead (' + mentionEls.length + ' found) ===');
        mentionEls.forEach((el, i) => {
          results.push('el[' + i + ']: testid=' + el.getAttribute('data-testid') +
            ' tag=' + el.tagName + ' class=' + el.className);
          results.push('html: ' + el.outerHTML.substring(0, 500));
        });
      }

      // Heuristic 4: class names containing "mention" or "typeahead" or "autocomplete"
      const classEls = document.querySelectorAll(
        '[class*="mention"], [class*="typeahead"], [class*="autocomplete"], ' +
        '[class*="Mention"], [class*="Typeahead"], [class*="Autocomplete"]'
      );
      if (classEls.length > 0) {
        results.push('=== class *mention*/*typeahead*/*autocomplete* (' + classEls.length + ' found) ===');
        classEls.forEach((el, i) => {
          if (i < 10) {
            results.push('el[' + i + ']: tag=' + el.tagName + ' class=' + el.className);
            results.push('html: ' + el.outerHTML.substring(0, 300));
          }
        });
      }

      // Heuristic 5: newly appeared fixed/absolute positioned overlays
      const overlays = document.querySelectorAll(
        'div[style*="position: fixed"], div[style*="position: absolute"], ' +
        'ul[style*="position: fixed"], ul[style*="position: absolute"]'
      );
      const visibleOverlays = Array.from(overlays).filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 50 && rect.height > 50;
      });
      if (visibleOverlays.length > 0) {
        results.push('=== visible fixed/absolute overlays (' + visibleOverlays.length + ' found) ===');
        visibleOverlays.forEach((el, i) => {
          if (i < 5) {
            const rect = el.getBoundingClientRect();
            results.push('overlay[' + i + ']: tag=' + el.tagName +
              ' class=' + el.className +
              ' rect=' + JSON.stringify({x: rect.x, y: rect.y, w: rect.width, h: rect.height}));
            results.push('html: ' + el.outerHTML.substring(0, 500));
          }
        });
      }

      // Heuristic 6: aria-expanded or aria-haspopup on the comment editor
      const editor = document.querySelector('[role="textbox"][aria-label^="Text editor for creating"]');
      if (editor) {
        results.push('=== comment editor ARIA state ===');
        results.push('aria-expanded: ' + editor.getAttribute('aria-expanded'));
        results.push('aria-haspopup: ' + editor.getAttribute('aria-haspopup'));
        results.push('aria-owns: ' + editor.getAttribute('aria-owns'));
        results.push('aria-controls: ' + editor.getAttribute('aria-controls'));
        results.push('aria-activedescendant: ' + editor.getAttribute('aria-activedescendant'));

        // Check the owned/controlled element
        const ownsId = editor.getAttribute('aria-owns') || editor.getAttribute('aria-controls');
        if (ownsId) {
          const ownedEl = document.getElementById(ownsId);
          if (ownedEl) {
            results.push('=== owned element #' + ownsId + ' ===');
            results.push('html: ' + ownedEl.outerHTML.substring(0, 1000));
          }
        }
      }

      if (results.length === 0) {
        results.push('NO MENTION POPUP ELEMENTS DETECTED');
      }

      return results.join('\\n');
    })()`,
  );
}

/**
 * Capture the editor innerHTML to see how LinkedIn represents mention entities.
 */
async function captureEditorState(client: CDPClient): Promise<string> {
  return client.evaluate<string>(
    `(() => {
      const editor = document.querySelector('[role="textbox"][aria-label^="Text editor for creating"]');
      if (!editor) return 'EDITOR NOT FOUND';
      return JSON.stringify({
        innerHTML: editor.innerHTML,
        textContent: editor.textContent,
        childNodes: Array.from(editor.childNodes).map(n => ({
          nodeType: n.nodeType,
          nodeName: n.nodeName,
          textContent: n.textContent?.substring(0, 200),
          outerHTML: n.nodeType === 1 ? n.outerHTML?.substring(0, 500) : undefined,
        })),
      }, null, 2);
    })()`,
  );
}

describeE2E("mention autocomplete spike (#712)", () => {
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

    // Navigate to post page
    await navigateAndWait(client, postUrl);
    await delay(3_000);
  }, 180_000);

  afterAll(async () => {
    // Clean up: clear the editor and press Escape to dismiss any popups
    if (client?.isConnected) {
      await client
        .evaluate(
          `(() => {
          const editor = document.querySelector('[role="textbox"][aria-label^="Text editor for creating"]');
          if (editor) {
            editor.textContent = '';
            editor.dispatchEvent(new Event('input', { bubbles: true }));
          }
        })()`,
        )
        .catch(() => {});
      await client
        .send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape" })
        .catch(() => {});
      await client
        .send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape" })
        .catch(() => {});
    }

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

  it("captures mention autocomplete DOM after typing @", async () => {
    // Step 1: Focus the comment input
    const focused = await client.evaluate<boolean>(
      `(() => {
        const el = document.querySelector(${JSON.stringify(COMMENT_INPUT)});
        if (!el) return false;
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        el.focus();
        return true;
      })()`,
    );
    expect(focused, "Comment input must be focusable").toBe(true);
    await delay(1_000);

    // Step 2: Probe BEFORE typing @ (baseline)
    const beforeProbe = await probeMentionPopup(client);
    console.log("\n[spike] === BEFORE typing @ ===\n" + beforeProbe);

    // Step 3: Type @ character
    await typeChar(client, "@");
    console.log("\n[spike] Typed @, waiting for autocomplete...");

    // Step 4: Wait progressively and probe at each interval
    for (const waitMs of [1_000, 2_000, 3_000]) {
      await delay(waitMs);
      const probe = await probeMentionPopup(client);
      console.log(
        `\n[spike] === AFTER @ + ${waitMs}ms wait ===\n` + probe,
      );
      if (!probe.includes("NO MENTION POPUP ELEMENTS DETECTED")) {
        console.log("[spike] Mention popup detected!");
        break;
      }
    }

    // Step 5: Type a few characters to filter the autocomplete
    const searchChars = "ale";
    for (const char of searchChars) {
      await typeChar(client, char);
    }
    console.log(`\n[spike] Typed additional "${searchChars}", waiting...`);
    await delay(2_000);

    const afterFilterProbe = await probeMentionPopup(client);
    console.log("\n[spike] === AFTER typing @" + searchChars + " ===\n" + afterFilterProbe);

    // Step 6: Capture editor internal state
    const editorState = await captureEditorState(client);
    console.log("\n[spike] === EDITOR STATE ===\n" + editorState);

    // Step 7: Check for any aria-activedescendant changes (keyboard nav)
    await client.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "ArrowDown",
      code: "ArrowDown",
      windowsVirtualKeyCode: 40,
    });
    await client.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "ArrowDown",
      code: "ArrowDown",
      windowsVirtualKeyCode: 40,
    });
    await delay(500);

    const afterArrowProbe = await probeMentionPopup(client);
    console.log("\n[spike] === AFTER ArrowDown ===\n" + afterArrowProbe);

    // Step 8: Try Enter to select mention
    const editorBeforeEnter = await captureEditorState(client);
    console.log("\n[spike] === EDITOR BEFORE ENTER ===\n" + editorBeforeEnter);

    await client.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
    await client.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
    await delay(1_000);

    const editorAfterEnter = await captureEditorState(client);
    console.log("\n[spike] === EDITOR AFTER ENTER (mention selected?) ===\n" + editorAfterEnter);

    const afterEnterProbe = await probeMentionPopup(client);
    console.log(
      "\n[spike] === POPUP STATE AFTER ENTER ===\n" + afterEnterProbe,
    );

    // Verify the mention was actually inserted into the editor
    const hasMentionAnchor = await client.evaluate<boolean>(
      `!!document.querySelector('a.ql-mention[data-entity-urn]')`,
    );
    expect(hasMentionAnchor, "Mention anchor (a.ql-mention) should be present in editor after Enter").toBe(true);
  }, 120_000);
});
