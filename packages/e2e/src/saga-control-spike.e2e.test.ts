// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Spike: Saga-control IPC surface discovery (#792)
 *
 * Goal: determine whether LinkedHelper exposes any way to pause/stop/resume
 * an in-flight `collect` saga from outside LH (via CDP `Runtime.evaluate`),
 * AND map remaining mws/contentWindow escape hatches that the saga driver
 * could lean on.
 *
 * Context (already verified by `state-spike.e2e.test.ts` 2026-05-06 run):
 * - `mws.callRead/callWrite('liWindow', 'checkIfInLoggedInState', ...)` ALL
 *   error out with "wrong method names for callRead" — the typed-call
 *   dispatch does NOT route to the liWindow.* state helpers.
 * - `mws.callRaw('liWindow.checkIfInLoggedInState', ...)` errors with
 *   "this.mainWindow[Q] is not a function" — same dead end.
 * - `mws.get('liWindow', 'state[extracted]')` returns `ok: true` but the
 *   value is `undefined` (the key is reachable, the data is not exposed).
 * - `mws.mainWindow.contentWindow` IS reachable as an `@electron/remote`
 *   proxy whose prototype likely carries `checkIfInLoggedInState`,
 *   `waitLoggedInState`, `state` etc. — this is the remaining escape hatch.
 *
 * Sections probed by THIS spike:
 *   1. §12 TODO — re-confirm get('liWindow', 'state[extracted]') and probe
 *      `mws.callWrite('liWindow.cancelExec')` (the only liWindow.* mws
 *      handler we already use in production via collection-spike's
 *      cancelExecution helper).
 *   2. ContentWindow proxy methods — enumerate prototype chain via
 *      `mws.mainWindow.contentWindow`, typeof check candidate methods,
 *      attempt `checkIfInLoggedInState(true)` call (primitive return,
 *      proxy-safe).
 *   3. Saga control surface — probe every plausible method name on the
 *      `collect` topic AND alternate dispatch shapes (`pauseCollect`,
 *      `liWindow.pauseExec`, etc.) to determine if pause/resume/stop
 *      exists in any form.
 *   4. mainWindow shape — enumerate `mws.mainWindow` own keys and
 *      candidate controller subobjects (names only, never read values).
 *
 * Goal isn't assertion — it's data collection.  Tests PASS even when
 * individual probes throw; the outer wrap captures every result.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  describeE2E,
  forceStopInstance,
  launchApp,
  quitApp,
  resolveAccountId,
  retryAsync,
} from "@lhremote/core/testing";
import {
  type AppService,
  discoverInstancePort,
  InstanceService,
  LauncherService,
  startInstanceWithRecovery,
} from "@lhremote/core";

const FEED_URL = "https://www.linkedin.com/feed/";

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

describeE2E("spike: saga control probe (#792)", () => {
  let app: AppService;
  let port: number;
  let accountId: number;
  let instance: InstanceService;

  beforeAll(async () => {
    const launched = await launchApp();
    app = launched.app;
    port = launched.port;

    accountId = await resolveAccountId(port);

    const launcher = new LauncherService(port);
    await retryAsync(() => launcher.connect(), { retries: 3, delay: 1_000 });
    await startInstanceWithRecovery(launcher, accountId, port);
    launcher.disconnect();

    const instancePort = await discoverInstancePort(port);
    if (instancePort === null) {
      throw new Error(`No instance CDP port discovered from launcher port ${String(port)}`);
    }

    instance = new InstanceService(instancePort);
    await instance.connect();

    // Settle into LoggedInState before probing — without this, the saga
    // probes may catch LH mid-navigation and report unrelated "stuck"
    // errors that mask the real handler-availability signal.
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

    console.log("\n\n====== SAGA SPIKE FINDINGS SUMMARY ======");
    console.log(JSON.stringify(findings, null, 2));
    console.log("=========================================\n");
  }, 60_000);

  // -------------------------------------------------------------------
  // 1. §12 TODO re-confirmation — only the unproven handlers + state route
  // -------------------------------------------------------------------

  describe("1. §12 TODO re-confirmation (mws state route)", () => {
    it("re-confirms get('liWindow', 'state[extracted]') resultType + value", async () => {
      const result = await probeExpression(instance, `(async () => {
        const mws = window.mainWindowService;
        if (!mws) return { status: 'no_mws' };
        try {
          const r = await mws.get('liWindow', 'state[extracted]');
          return {
            status: 'ok',
            resultType: typeof r,
            isNull: r === null,
            isUndefined: r === undefined,
            value: r === null || r === undefined ? r : JSON.parse(JSON.stringify(r)),
          };
        } catch (e) {
          return { status: 'error', error: String(e && e.message || e) };
        }
      })()`);
      recordFinding("§12-state", "get('liWindow','state[extracted]')", result);
      expect(result.ok).toBe(true);
    }, 30_000);

    it("probes mws.callWrite('liWindow.cancelExec') — only known-working liWindow handler", async () => {
      const result = await probeExpression(instance, `(async () => {
        const mws = window.mainWindowService;
        if (!mws) return { status: 'no_mws' };
        try {
          const r = await mws.callWrite('liWindow.cancelExec');
          return { status: 'ok', resultType: typeof r, value: r === undefined ? 'undefined' : r };
        } catch (e) {
          return { status: 'error', error: String(e && e.message || e) };
        }
      })()`);
      recordFinding("§12-cancelExec", "callWrite('liWindow.cancelExec')", result);
      expect(result.ok).toBe(true);
    }, 30_000);

    it("probes alternate forms of cancelExec dispatch", async () => {
      const dispatches = [
        { variant: "callWrite", form: "topic+method", expr: `mws.callWrite('liWindow', 'cancelExec')` },
        { variant: "callRead", form: "dotted", expr: `mws.callRead('liWindow.cancelExec')` },
        { variant: "callWrite", form: "standalone", expr: `mws.callWrite('cancelExec')` },
        { variant: "callRaw", form: "dotted", expr: `mws.callRaw('liWindow.cancelExec')` },
      ];
      const matrix: Record<string, unknown> = {};
      for (const d of dispatches) {
        const r = await probeExpression(instance, `(async () => {
          const mws = window.mainWindowService;
          if (!mws) return { status: 'no_mws' };
          try {
            const x = await ${d.expr};
            return { status: 'ok', resultType: typeof x };
          } catch (e) {
            return { status: 'error', error: String(e && e.message || e) };
          }
        })()`);
        matrix[`${d.variant}/${d.form}`] = r;
      }
      recordFinding("§12-cancelExec", "alternate dispatches", matrix);
      expect(Object.keys(matrix)).toHaveLength(dispatches.length);
    }, 60_000);
  });

  // -------------------------------------------------------------------
  // 2. ContentWindow proxy probe — escape hatch via @electron/remote
  // -------------------------------------------------------------------

  describe("2. ContentWindow proxy methods (escape hatch)", () => {
    it("enumerates mws.mainWindow.contentWindow prototype chain (names only)", async () => {
      const result = await probeExpression(instance, `(async () => {
        const mws = window.mainWindowService;
        if (!mws) return { status: 'no_mws' };
        const cw = mws.mainWindow && mws.mainWindow.contentWindow;
        if (!cw) return { status: 'cw_absent' };
        try {
          const protoChain = [];
          let p = Object.getPrototypeOf(cw);
          let depth = 0;
          while (p && p !== Object.prototype && depth < 8) {
            const ctor = p.constructor && p.constructor.name;
            const names = Object.getOwnPropertyNames(p);
            protoChain.push({ depth, ctor, namesCount: names.length, names: names.slice(0, 200) });
            p = Object.getPrototypeOf(p);
            depth++;
          }
          return { status: 'ok', ctor: cw.constructor && cw.constructor.name, protoChain };
        } catch (e) {
          return { status: 'error', error: String(e && e.message || e) };
        }
      })()`);
      recordFinding("contentWindow", "prototype chain", result);
      expect(result.ok).toBe(true);
    }, 30_000);

    it("typeof check on contentWindow candidate state methods", async () => {
      const result = await probeExpression(instance, `(async () => {
        const mws = window.mainWindowService;
        if (!mws) return { status: 'no_mws' };
        const cw = mws.mainWindow && mws.mainWindow.contentWindow;
        if (!cw) return { status: 'cw_absent' };
        const candidates = [
          'checkIfInLoggedInState', 'waitLoggedInState', 'assertLoggedInState',
          'checkState', 'assertState', 'waitState',
          'state', 'isFinal',
          'cancelExec', 'pauseExec', 'stopExec', 'resumeExec',
          'isRunning', 'isPaused', 'isCollecting', 'isIdle',
          'exec', 'execStatus', 'executionState', 'runnerState',
        ];
        const types = {};
        for (const k of candidates) {
          try { types[k] = typeof cw[k]; } catch (e) { types[k] = 'throw: ' + String(e); }
        }
        return { status: 'ok', types };
      })()`);
      recordFinding("contentWindow", "typeof candidate methods", result);
      expect(result.ok).toBe(true);
    }, 30_000);

    it("attempts contentWindow.checkIfInLoggedInState(true) — primitive return path", async () => {
      const result = await probeExpression(instance, `(async () => {
        const mws = window.mainWindowService;
        if (!mws) return { status: 'no_mws' };
        const cw = mws.mainWindow && mws.mainWindow.contentWindow;
        if (!cw) return { status: 'cw_absent' };
        if (typeof cw.checkIfInLoggedInState !== 'function') return { status: 'method_absent' };
        try {
          const r = cw.checkIfInLoggedInState(true);
          // Could be a remote proxy promise — await it.
          const awaited = (r && typeof r.then === 'function') ? await r : r;
          return { status: 'ok', resultType: typeof awaited, value: awaited };
        } catch (e) {
          return { status: 'error', error: String(e && e.message || e) };
        }
      })()`);
      recordFinding("contentWindow", "checkIfInLoggedInState(true)", result);
      expect(result.ok).toBe(true);
    }, 30_000);

    it("attempts contentWindow.waitLoggedInState(true, 5000) — bluebird promise", async () => {
      const result = await probeExpression(instance, `(async () => {
        const mws = window.mainWindowService;
        if (!mws) return { status: 'no_mws' };
        const cw = mws.mainWindow && mws.mainWindow.contentWindow;
        if (!cw) return { status: 'cw_absent' };
        if (typeof cw.waitLoggedInState !== 'function') return { status: 'method_absent' };
        const start = Date.now();
        try {
          const r = cw.waitLoggedInState(true, 5000);
          const awaited = (r && typeof r.then === 'function') ? await r : r;
          return { status: 'ok', resultType: typeof awaited, value: awaited === undefined ? 'undefined' : awaited, elapsedMs: Date.now() - start };
        } catch (e) {
          return { status: 'error', error: String(e && e.message || e), elapsedMs: Date.now() - start };
        }
      })()`);
      recordFinding("contentWindow", "waitLoggedInState(true,5000)", result);
      expect(result.ok).toBe(true);
    }, 30_000);
  });

  // -------------------------------------------------------------------
  // 3. Saga control surface — collect topic + alternates
  // -------------------------------------------------------------------

  describe("3. Saga control surface", () => {
    it("probes mws.callRead('collect', method) for status/info read methods", async () => {
      const methods = [
        "getStatus", "status", "state", "info", "getInfo",
        "getCurrentState", "currentState", "isRunning",
        "isPaused", "isCollecting", "getProgress",
        "getCampaignId", "getActionId",
      ];
      const matrix: Record<string, unknown> = {};
      for (const m of methods) {
        const r = await probeExpression(instance, `(async () => {
          const mws = window.mainWindowService;
          try {
            const x = await mws.callRead('collect', ${JSON.stringify(m)});
            return { status: 'ok', resultType: typeof x, value: x };
          } catch (e) {
            return { status: 'error', error: String(e && e.message || e) };
          }
        })()`);
        matrix[m] = r;
      }
      recordFinding("collect-read", "callRead('collect', <method>)", matrix);
      expect(Object.keys(matrix)).toHaveLength(methods.length);
    }, 90_000);

    it("probes mws.callWrite('collect', method) for pause/stop/resume/cancel", async () => {
      const methods = [
        "pause", "resume", "stop", "cancel", "abort", "halt",
        "pauseCollect", "resumeCollect", "stopCollect", "cancelCollect",
      ];
      const matrix: Record<string, unknown> = {};
      for (const m of methods) {
        const r = await probeExpression(instance, `(async () => {
          const mws = window.mainWindowService;
          try {
            const x = await mws.callWrite('collect', ${JSON.stringify(m)});
            return { status: 'ok', resultType: typeof x, value: x };
          } catch (e) {
            return { status: 'error', error: String(e && e.message || e) };
          }
        })()`);
        matrix[m] = r;
      }
      recordFinding("collect-write", "callWrite('collect', <method>)", matrix);
      expect(Object.keys(matrix)).toHaveLength(methods.length);
    }, 90_000);

    it("probes standalone handler names (no topic prefix)", async () => {
      const handlers = [
        { name: "pauseCollect", variant: "callWrite" },
        { name: "resumeCollect", variant: "callWrite" },
        { name: "stopCollect", variant: "callWrite" },
        { name: "cancelCollect", variant: "callWrite" },
        { name: "abortCollect", variant: "callWrite" },
        { name: "pauseExec", variant: "callWrite" },
        { name: "resumeExec", variant: "callWrite" },
        { name: "stopExec", variant: "callWrite" },
        { name: "abortExec", variant: "callWrite" },
        { name: "cancelExec", variant: "callWrite" },
        { name: "getCollectStatus", variant: "callRead" },
        { name: "getCollectState", variant: "callRead" },
        { name: "getRunnerState", variant: "callRead" },
        { name: "getExecutionState", variant: "callRead" },
        { name: "isCollecting", variant: "callRead" },
        { name: "isRunning", variant: "callRead" },
      ];
      const matrix: Record<string, unknown> = {};
      for (const h of handlers) {
        const r = await probeExpression(instance, `(async () => {
          const mws = window.mainWindowService;
          try {
            const x = await mws[${JSON.stringify(h.variant)}](${JSON.stringify(h.name)});
            return { status: 'ok', resultType: typeof x, value: x };
          } catch (e) {
            return { status: 'error', error: String(e && e.message || e) };
          }
        })()`);
        matrix[`${h.variant}/${h.name}`] = r;
      }
      recordFinding("standalone-handlers", "callWrite/callRead(<handler>)", matrix);
      expect(Object.keys(matrix)).toHaveLength(handlers.length);
    }, 120_000);

    it("probes liWindow.* dotted forms for saga control", async () => {
      const handlers = [
        { name: "liWindow.pauseExec", variant: "callWrite" },
        { name: "liWindow.resumeExec", variant: "callWrite" },
        { name: "liWindow.stopExec", variant: "callWrite" },
        { name: "liWindow.abortExec", variant: "callWrite" },
        { name: "liWindow.executionState", variant: "callRead" },
        { name: "liWindow.execStatus", variant: "callRead" },
        { name: "liWindow.isExecuting", variant: "callRead" },
        { name: "liWindow.isRunning", variant: "callRead" },
        { name: "liWindow.checkIsRunning", variant: "callRead" },
      ];
      const matrix: Record<string, unknown> = {};
      for (const h of handlers) {
        const r = await probeExpression(instance, `(async () => {
          const mws = window.mainWindowService;
          try {
            const x = await mws[${JSON.stringify(h.variant)}](${JSON.stringify(h.name)});
            return { status: 'ok', resultType: typeof x, value: x };
          } catch (e) {
            return { status: 'error', error: String(e && e.message || e) };
          }
        })()`);
        matrix[`${h.variant}/${h.name}`] = r;
      }
      recordFinding("liwindow-dotted", "liWindow.* saga handlers", matrix);
      expect(Object.keys(matrix)).toHaveLength(handlers.length);
    }, 90_000);
  });

  // -------------------------------------------------------------------
  // 4. mainWindow shape — controller subobject discovery
  // -------------------------------------------------------------------

  describe("4. mainWindow shape", () => {
    it("enumerates mws.mainWindow own keys + ctor name", async () => {
      const result = await probeExpression(instance, `(async () => {
        const mws = window.mainWindowService;
        const mw = mws && mws.mainWindow;
        if (!mw) return { status: 'mw_absent' };
        try {
          // Names ONLY — never read values from the @electron/remote proxy.
          return {
            status: 'ok',
            ctor: mw.constructor && mw.constructor.name,
            ownKeys: Object.keys(mw).slice(0, 100),
            ownPropertyNames: Object.getOwnPropertyNames(mw).slice(0, 100),
          };
        } catch (e) {
          return { status: 'error', error: String(e && e.message || e) };
        }
      })()`);
      recordFinding("mainWindow", "own keys + ctor", result);
      expect(result.ok).toBe(true);
    }, 30_000);

    it("typeof check on mainWindow candidate controller subobjects", async () => {
      const result = await probeExpression(instance, `(async () => {
        const mws = window.mainWindowService;
        const mw = mws && mws.mainWindow;
        if (!mw) return { status: 'mw_absent' };
        const candidates = [
          'contentWindowController', 'executionController', 'runnerController',
          'campaignController', 'collectController', 'sagaController',
          'controller', 'controllers', 'state', 'store', 'reduxStore',
          'runner', 'executor', 'exec', 'isRunning', 'isPaused',
          'pauseExec', 'resumeExec', 'stopExec', 'cancelExec',
          'pause', 'resume', 'stop', 'cancel',
        ];
        const types = {};
        for (const k of candidates) {
          try { types[k] = typeof mw[k]; } catch (e) { types[k] = 'throw: ' + String(e); }
        }
        return { status: 'ok', types };
      })()`);
      recordFinding("mainWindow", "typeof candidate controllers", result);
      expect(result.ok).toBe(true);
    }, 30_000);

    it("enumerates mws.mainWindow prototype chain (names only)", async () => {
      const result = await probeExpression(instance, `(async () => {
        const mws = window.mainWindowService;
        const mw = mws && mws.mainWindow;
        if (!mw) return { status: 'mw_absent' };
        try {
          const protoChain = [];
          let p = Object.getPrototypeOf(mw);
          let depth = 0;
          while (p && p !== Object.prototype && depth < 8) {
            const ctor = p.constructor && p.constructor.name;
            const names = Object.getOwnPropertyNames(p);
            protoChain.push({ depth, ctor, namesCount: names.length, names: names.slice(0, 200) });
            p = Object.getPrototypeOf(p);
            depth++;
          }
          return { status: 'ok', protoChain };
        } catch (e) {
          return { status: 'error', error: String(e && e.message || e) };
        }
      })()`);
      recordFinding("mainWindow", "prototype chain", result);
      expect(result.ok).toBe(true);
    }, 30_000);
  });
});
