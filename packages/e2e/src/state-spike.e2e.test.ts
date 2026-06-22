// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Spike: Verify LinkedHelper `liWindow` state IPC channel (#781)
 *
 * Probes whether `mws.callRead`/`callWrite`/`get` round-trip correctly to
 * the LinkedIn ContentWindow state-machine helpers from outside the LH
 * process.  See research/linkedhelper/state/li-window-state-machine-20260506.md
 * §12 for the verification gap this spike closes.
 *
 * Probes (all run via instance.evaluateUI):
 * - `mws.callRead('liWindow', 'checkIfInLoggedInState', true)` (topic+method form)
 * - `mws.callRead('liWindow.checkIfInLoggedInState', true)`    (dotted form)
 * - `mws.get('liWindow', 'state[extracted]')`                  (state snapshot)
 * - `mws.callWrite('liWindow', 'waitLoggedInState', true, 5000)`
 *
 * Goal: prove the channel works (or doesn't) before relying on it in the
 * `waitForLoggedInState` helper.  Records findings to console for inspection.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  describeE2E,
  forceStopInstance,
  launchApp,
  quitApp,
  resolveAccountId,
  retryAsync,
} from "@insoftex/lhremote-core/testing";
import {
  type AppService,
  CDPClient,
  discoverInstancePort,
  discoverTargets,
  InstanceService,
  LauncherService,
  startInstanceWithRecovery,
} from "@insoftex/lhremote-core";

/** LinkedIn feed URL — the canonical logged-in URL where checkIfInLoggedInState should return true. */
const FEED_URL = "https://www.linkedin.com/feed/";

/**
 * Evaluate an arbitrary expression on the UI target and return the
 * result or error.
 */
async function probeExpression<T = unknown>(
  instance: InstanceService,
  expression: string,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    const value = await instance.evaluateUI<T>(expression);
    return { ok: true, value };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

const findings: Array<{ section: string; test: string; result: unknown }> = [];

function recordFinding(section: string, test: string, result: unknown): void {
  findings.push({ section, test, result });
  console.log(`\n=== [${section}] ${test} ===`);
  console.log(JSON.stringify(result, null, 2));
}

describeE2E("spike: liWindow state IPC channel (#781)", () => {
  let app: AppService;
  let port: number;
  let accountId: number;
  let instance: InstanceService;
  let instancePort: number;

  beforeAll(async () => {
    const launched = await launchApp();
    app = launched.app;
    port = launched.port;

    accountId = await resolveAccountId(port);

    const launcher = new LauncherService(port);
    await retryAsync(() => launcher.connect(), { retries: 3, delay: 1_000 });
    await startInstanceWithRecovery(launcher, accountId, port);
    launcher.disconnect();

    const discoveredInstancePort = await discoverInstancePort(port);
    if (discoveredInstancePort === null) {
      throw new Error(`No instance CDP port discovered from launcher port ${String(port)}`);
    }
    instancePort = discoveredInstancePort;

    instance = new InstanceService(instancePort);
    await instance.connect();

    // Navigate to feed and give LH a moment to settle into LoggedInState
    // before any probe — without this, the first probe may catch the CW in
    // LoggedInLoadingState and report `false` for an unrelated reason.
    await instance.navigateLinkedIn(FEED_URL);
    await new Promise((resolve) => setTimeout(resolve, 8_000));
  }, 180_000);

  afterAll(async () => {
    instance?.disconnect();

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

    console.log("\n\n====== STATE SPIKE FINDINGS SUMMARY ======");
    console.log(JSON.stringify(findings, null, 2));
    console.log("==========================================\n");
  }, 60_000);

  describe("1. checkIfInLoggedInState — invocation forms", () => {
    it("probes mws.callRead('liWindow', 'checkIfInLoggedInState', true) — topic+method form", async () => {
      const result = await probeExpression(instance, `(async () => {
        const mws = window.mainWindowService;
        if (!mws) return { status: 'no_mws' };
        try {
          const r = await mws.callRead('liWindow', 'checkIfInLoggedInState', true);
          return { status: 'ok', resultType: typeof r, value: r };
        } catch (e) {
          return { status: 'error', error: String(e && e.message || e) };
        }
      })()`);
      recordFinding("checkIfInLoggedInState", "callRead('liWindow','checkIfInLoggedInState',true)", result);
      expect(result.ok).toBe(true);
    }, 30_000);

    it("probes mws.callRead('liWindow.checkIfInLoggedInState', true) — dotted form", async () => {
      const result = await probeExpression(instance, `(async () => {
        const mws = window.mainWindowService;
        if (!mws) return { status: 'no_mws' };
        try {
          const r = await mws.callRead('liWindow.checkIfInLoggedInState', true);
          return { status: 'ok', resultType: typeof r, value: r };
        } catch (e) {
          return { status: 'error', error: String(e && e.message || e) };
        }
      })()`);
      recordFinding("checkIfInLoggedInState", "callRead('liWindow.checkIfInLoggedInState',true)", result);
      expect(result.ok).toBe(true);
    }, 30_000);

    it("probes mws.callRead('liWindow', 'checkIfInLoggedInState', false) — accept loading variants", async () => {
      const result = await probeExpression(instance, `(async () => {
        const mws = window.mainWindowService;
        if (!mws) return { status: 'no_mws' };
        try {
          const r = await mws.callRead('liWindow', 'checkIfInLoggedInState', false);
          return { status: 'ok', resultType: typeof r, value: r };
        } catch (e) {
          return { status: 'error', error: String(e && e.message || e) };
        }
      })()`);
      recordFinding("checkIfInLoggedInState", "callRead('liWindow','checkIfInLoggedInState',false)", result);
      expect(result.ok).toBe(true);
    }, 30_000);

    it("probes mws.callRead('liWindow', 'checkIfInLoggedInState') — no isFinal arg", async () => {
      const result = await probeExpression(instance, `(async () => {
        const mws = window.mainWindowService;
        if (!mws) return { status: 'no_mws' };
        try {
          const r = await mws.callRead('liWindow', 'checkIfInLoggedInState');
          return { status: 'ok', resultType: typeof r, value: r };
        } catch (e) {
          return { status: 'error', error: String(e && e.message || e) };
        }
      })()`);
      recordFinding("checkIfInLoggedInState", "callRead('liWindow','checkIfInLoggedInState')", result);
      expect(result.ok).toBe(true);
    }, 30_000);
  });

  describe("2. state[extracted] getter", () => {
    it("probes mws.get('liWindow', 'state[extracted]') — topic+key form", async () => {
      const result = await probeExpression(instance, `(async () => {
        const mws = window.mainWindowService;
        if (!mws) return { status: 'no_mws' };
        try {
          const r = await mws.get('liWindow', 'state[extracted]');
          return {
            status: 'ok',
            resultType: typeof r,
            keys: r && typeof r === 'object' ? Object.keys(r).slice(0, 30) : null,
            preview: r && typeof r === 'object' ? JSON.parse(JSON.stringify(r)) : r,
          };
        } catch (e) {
          return { status: 'error', error: String(e && e.message || e) };
        }
      })()`);
      recordFinding("state[extracted]", "get('liWindow','state[extracted]')", result);
      expect(result.ok).toBe(true);
    }, 30_000);

    it("probes mws.get('liWindow.state[extracted]') — dotted form", async () => {
      const result = await probeExpression(instance, `(async () => {
        const mws = window.mainWindowService;
        if (!mws) return { status: 'no_mws' };
        try {
          const r = await mws.get('liWindow.state[extracted]');
          return {
            status: 'ok',
            resultType: typeof r,
            keys: r && typeof r === 'object' ? Object.keys(r).slice(0, 30) : null,
          };
        } catch (e) {
          return { status: 'error', error: String(e && e.message || e) };
        }
      })()`);
      recordFinding("state[extracted]", "get('liWindow.state[extracted]')", result);
      expect(result.ok).toBe(true);
    }, 30_000);

    it("probes mws.get('liWindow', 'state') — alternate key", async () => {
      const result = await probeExpression(instance, `(async () => {
        const mws = window.mainWindowService;
        if (!mws) return { status: 'no_mws' };
        try {
          const r = await mws.get('liWindow', 'state');
          return {
            status: 'ok',
            resultType: typeof r,
            keys: r && typeof r === 'object' ? Object.keys(r).slice(0, 30) : null,
          };
        } catch (e) {
          return { status: 'error', error: String(e && e.message || e) };
        }
      })()`);
      recordFinding("state[extracted]", "get('liWindow','state')", result);
      expect(result.ok).toBe(true);
    }, 30_000);
  });

  describe("3. waitLoggedInState (awaitable)", () => {
    it("probes mws.callWrite('liWindow', 'waitLoggedInState', true, 5000)", async () => {
      const result = await probeExpression(instance, `(async () => {
        const mws = window.mainWindowService;
        if (!mws) return { status: 'no_mws' };
        const start = Date.now();
        try {
          const r = await mws.callWrite('liWindow', 'waitLoggedInState', true, 5000);
          return { status: 'ok', resultType: typeof r, value: r, elapsedMs: Date.now() - start };
        } catch (e) {
          return { status: 'error', error: String(e && e.message || e), elapsedMs: Date.now() - start };
        }
      })()`);
      recordFinding("waitLoggedInState", "callWrite('liWindow','waitLoggedInState',true,5000)", result);
      expect(result.ok).toBe(true);
    }, 30_000);

    it("probes mws.callRead('liWindow', 'waitLoggedInState', true, 5000)", async () => {
      const result = await probeExpression(instance, `(async () => {
        const mws = window.mainWindowService;
        if (!mws) return { status: 'no_mws' };
        const start = Date.now();
        try {
          const r = await mws.callRead('liWindow', 'waitLoggedInState', true, 5000);
          return { status: 'ok', resultType: typeof r, value: r, elapsedMs: Date.now() - start };
        } catch (e) {
          return { status: 'error', error: String(e && e.message || e), elapsedMs: Date.now() - start };
        }
      })()`);
      recordFinding("waitLoggedInState", "callRead('liWindow','waitLoggedInState',true,5000)", result);
      expect(result.ok).toBe(true);
    }, 30_000);
  });

  describe("4. callRaw + alternate dispatchers (escape hatches)", () => {
    it("probes mws.callRaw('liWindow.checkIfInLoggedInState', true) — dotted form", async () => {
      const result = await probeExpression(instance, `(async () => {
        const mws = window.mainWindowService;
        if (!mws) return { status: 'no_mws' };
        if (typeof mws.callRaw !== 'function') return { status: 'callRaw_absent' };
        try {
          const r = await mws.callRaw('liWindow.checkIfInLoggedInState', true);
          return { status: 'ok', resultType: typeof r, value: r };
        } catch (e) {
          return { status: 'error', error: String(e && e.message || e) };
        }
      })()`);
      recordFinding("callRaw", "callRaw('liWindow.checkIfInLoggedInState',true)", result);
      expect(result.ok).toBe(true);
    }, 30_000);

    it("probes mws.callRaw('liWindow', 'checkIfInLoggedInState', true) — topic+method form", async () => {
      const result = await probeExpression(instance, `(async () => {
        const mws = window.mainWindowService;
        if (!mws) return { status: 'no_mws' };
        if (typeof mws.callRaw !== 'function') return { status: 'callRaw_absent' };
        try {
          const r = await mws.callRaw('liWindow', 'checkIfInLoggedInState', true);
          return { status: 'ok', resultType: typeof r, value: r };
        } catch (e) {
          return { status: 'error', error: String(e && e.message || e) };
        }
      })()`);
      recordFinding("callRaw", "callRaw('liWindow','checkIfInLoggedInState',true)", result);
      expect(result.ok).toBe(true);
    }, 30_000);

    it("probes mws.getContentWindow() shape (names-only)", async () => {
      const result = await probeExpression(instance, `(async () => {
        const mws = window.mainWindowService;
        if (!mws) return { status: 'no_mws' };
        if (typeof mws.getContentWindow !== 'function') return { status: 'getContentWindow_absent' };
        try {
          const cw = await mws.getContentWindow();
          if (!cw) return { status: 'ok', value: null };
          return {
            status: 'ok',
            resultType: typeof cw,
            ctor: cw.constructor && cw.constructor.name,
            ownKeys: Object.keys(cw).slice(0, 30),
            // typeof of candidate methods — never read values from a remote-proxy.
            checkIfInLoggedInStateType: typeof cw.checkIfInLoggedInState,
            waitLoggedInStateType: typeof cw.waitLoggedInState,
            stateType: typeof cw.state,
            isFinalType: typeof cw.isFinal,
          };
        } catch (e) {
          return { status: 'error', error: String(e && e.message || e) };
        }
      })()`);
      recordFinding("getContentWindow", "getContentWindow() shape", result);
      expect(result.ok).toBe(true);
    }, 30_000);

    it("probes window.mainWindowService.mainWindow.contentWindow shape (names-only)", async () => {
      const result = await probeExpression(instance, `(async () => {
        const mws = window.mainWindowService;
        if (!mws) return { status: 'no_mws' };
        const mw = mws.mainWindow;
        if (!mw) return { status: 'mainWindow_absent' };
        const cw = mw.contentWindow;
        if (cw === undefined) return { status: 'contentWindow_undefined' };
        try {
          // names-only — DO NOT read values, see V2113-MWS-TYPED-CALL.md note
          // about @electron/remote proxy values causing main-process crashes.
          return {
            status: 'ok',
            resultType: typeof cw,
            isNull: cw === null,
            ctor: cw && cw.constructor && cw.constructor.name,
            ownKeys: cw ? Object.keys(cw).slice(0, 30) : null,
          };
        } catch (e) {
          return { status: 'error', error: String(e && e.message || e) };
        }
      })()`);
      recordFinding("contentWindow", "mws.mainWindow.contentWindow shape", result);
      expect(result.ok).toBe(true);
    }, 30_000);

    it("verifies DOM heuristic on LinkedIn target — research §11.1 fallback", async () => {
      // The IPC channel above is closed for the liWindow topic — fall back
      // to the DOM heuristic recommended in research §11.1.  Open a
      // dedicated CDPClient on the LinkedIn target (the InstanceService's
      // evaluateUI runs against the Electron renderer, not linkedin.com).
      const targets = await discoverTargets(instancePort);
      const linkedInTarget = targets.find(
        (t) => t.type === "page" && t.url.includes("linkedin.com"),
      );
      if (!linkedInTarget) throw new Error("No linkedin.com target found");

      const liClient = new CDPClient(instancePort);
      await liClient.connect(linkedInTarget.id);
      try {
        const result = await liClient.evaluate<{
          hostname: string;
          pathname: string;
          pathMatch: boolean;
          hasProfileShrinkImg: boolean;
          hasMain: boolean;
          title: string;
        }>(`(() => {
          const out = { hostname: location.hostname, pathname: location.pathname };
          const PATHS = ['/feed', '/in/', '/mynetwork', '/search', '/messaging', '/groups', '/company', '/posts', '/events'];
          out.pathMatch = PATHS.some(p => location.pathname.startsWith(p));
          // Probe several plausible "me-rendered" selectors: the global nav
          // avatar, the profile-displayphoto image, and a generic header.
          out.hasGlobalNavAvatar = !!document.querySelector('img[data-test-app-aware-link]');
          out.hasProfileShrinkImg = !!document.querySelector('img[alt][src*="profile-displayphoto-shrink"]');
          out.hasGlobalNav = !!document.querySelector('nav.global-nav, [data-test-global-nav]');
          out.hasGlobalNavMeButton = !!document.querySelector('button[id*="global-nav-typeahead"], li-icon[type="me-icon"], [data-control-name="nav.settings"]');
          out.hasMain = !!document.querySelector('main');
          out.hasGlobalNavSearch = !!document.querySelector('.global-nav__search, input[role="combobox"][placeholder*="Search"]');
          // Capture title for cross-checking.
          out.title = document.title;
          return out;
        })()`);
        recordFinding("dom-heuristic", "LinkedIn target DOM probes", { ok: true, value: result });

        // Regression assertions: any future LinkedIn rewrite that breaks one
        // of these signals must surface here so the helper's predicate can
        // be re-tuned before `waitForLoggedInState` falls behind.
        expect(result.hostname, "hostname must match LH LoggedInState.canEnter").toBe("www.linkedin.com");
        expect(result.pathMatch, "pathname must match the LoggedInState path-prefix set").toBe(true);
        expect(
          result.hasProfileShrinkImg,
          "profile-displayphoto-shrink avatar must render once meRawData hydrates — this is the helper's primary signal",
        ).toBe(true);
      } finally {
        liClient.disconnect();
      }
    }, 30_000);

    it("enumerates dispatcher methods + topic candidates on mws prototype", async () => {
      const result = await probeExpression(instance, `(async () => {
        const mws = window.mainWindowService;
        if (!mws) return { status: 'no_mws' };
        const protoNames = [];
        try {
          let p = Object.getPrototypeOf(mws);
          let depth = 0;
          while (p && p !== Object.prototype && depth < 5) {
            protoNames.push({
              ctor: p.constructor && p.constructor.name,
              names: Object.getOwnPropertyNames(p).slice(0, 100),
            });
            p = Object.getPrototypeOf(p);
            depth++;
          }
        } catch (e) {
          return { status: 'error', error: String(e && e.message || e) };
        }
        return { status: 'ok', protoNames, ownKeys: Object.keys(mws) };
      })()`);
      recordFinding("dispatcher-shape", "mws prototype enumeration", result);
      expect(result.ok).toBe(true);
    }, 30_000);
  });
});
