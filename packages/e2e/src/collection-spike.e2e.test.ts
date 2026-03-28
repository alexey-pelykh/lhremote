// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * Spike: Verify collection CDP entry points (#401)
 *
 * This E2E test systematically probes LinkedHelper's collection IPC methods
 * via CDP to determine exact parameter signatures, return values, state machine
 * transitions, and error modes.
 *
 * Methods under test:
 * - canCollect(sourceType)
 * - prepareCollecting({ type, actionType })
 * - collect(params)
 * - executeSingleAction('AutoCollectPeople', config)
 *
 * Output: findings are logged to console and documented in
 * research/linkedhelper/poc/COLLECTION-CDP-ENTRY-POINTS.md
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeE2E, forceStopInstance, launchApp, quitApp, resolveAccountId, retryAsync } from "@lhremote/core/testing";
import {
  type AppService,
  discoverInstancePort,
  InstanceService,
  LauncherService,
  startInstanceWithRecovery,
} from "@lhremote/core";

/** LinkedIn people search URL for testing collection. */
const TEST_SEARCH_URL =
  "https://www.linkedin.com/search/results/people/?keywords=software%20engineer&origin=GLOBAL_SEARCH_HEADER";

/**
 * Helper to call an IPC method on mainWindowService and capture the result
 * or error without failing the test.
 */
async function probeIpcMethod<T = unknown>(
  instance: InstanceService,
  methodName: string,
  ...args: unknown[]
): Promise<{ ok: true; value: T } | { ok: false; error: string; stack?: string }> {
  const argsJson = args.map((a) => JSON.stringify(a)).join(", ");
  const expression = `(async () => {
    const mws = window.mainWindowService;
    if (!mws) throw new Error('mainWindowService not found on window');
    const result = await mws.call(${JSON.stringify(methodName)}${argsJson ? ", " + argsJson : ""});
    return result;
  })()`;

  try {
    const value = await instance.evaluateUI<T>(expression);
    return { ok: true, value };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    return { ok: false, error: msg, stack };
  }
}

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

/**
 * Cancel any running execution (single-action, collection, etc.) to
 * return the state machine to idle.
 */
async function cancelExecution(instance: InstanceService): Promise<void> {
  await probeExpression(instance, `(async () => {
    const mws = window.mainWindowService;
    if (!mws) return;
    try { await mws.call('liWindow.cancelExec'); } catch {}
    try {
      const mw = mws.mainWindow;
      if (mw && mw.contentWindowController) {
        await mw.contentWindowController.cancelExec?.();
      }
    } catch {}
  })()`);
}

/** Retrieve the current execution/runner state from the Redux store. */
async function getRunnerState(
  instance: InstanceService,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  return probeExpression(instance, `(async () => {
    const mws = window.mainWindowService;
    if (!mws) return { error: 'no mainWindowService' };

    // Try reading state from the mainWindowService itself
    try {
      const state = mws.executionState || mws.state;
      if (state) return { source: 'mws.executionState', state };
    } catch {}

    // Try Redux store
    try {
      const store = window.__REDUX_STORE__ || window.__store__;
      if (store) {
        const s = store.getState();
        return {
          source: 'redux',
          executionState: s?.execution || s?.runner || s?.mainWindow?.executionState,
          keys: Object.keys(s || {}).slice(0, 20),
        };
      }
    } catch {}

    return { source: 'none', note: 'Could not locate execution state' };
  })()`);
}

/** Collect findings into a structured log for later documentation. */
const findings: Array<{ section: string; test: string; result: unknown }> = [];

function recordFinding(section: string, test: string, result: unknown): void {
  findings.push({ section, test, result });
  // Also log to console for immediate visibility during test run
  console.log(`\n=== [${section}] ${test} ===`);
  console.log(JSON.stringify(result, null, 2));
}

describeE2E("spike: collection CDP entry points (#401)", () => {
  let app: AppService;
  let port: number;
  let accountId: number;
  let instance: InstanceService;

  beforeAll(async () => {
    const launched = await launchApp();
    app = launched.app;
    port = launched.port;

    accountId = await resolveAccountId(port);

    // Start an account instance
    const launcher = new LauncherService(port);
    await retryAsync(() => launcher.connect(), { retries: 3, delay: 1_000 });
    await startInstanceWithRecovery(launcher, accountId, port);
    launcher.disconnect();

    // Discover instance CDP port (separate from launcher port)
    const instancePort = await discoverInstancePort(port);
    if (instancePort === null) {
      throw new Error(`No instance CDP port discovered from launcher port ${String(port)}`);
    }

    // Connect to instance CDP targets
    instance = new InstanceService(instancePort);
    await instance.connect();
  }, 120_000);

  afterAll(async () => {
    // Try to cancel any lingering execution
    if (instance?.isConnected) {
      await cancelExecution(instance);
    }
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

    // Print all findings as a summary
    console.log("\n\n====== SPIKE FINDINGS SUMMARY ======");
    console.log(JSON.stringify(findings, null, 2));
    console.log("====================================\n");
  }, 60_000);

  // -------------------------------------------------------------------
  // 1. Baseline: environment probing
  // -------------------------------------------------------------------

  describe("1. baseline: environment probing", () => {
    it("verifies mainWindowService availability", async () => {
      const result = await probeExpression(instance, `(async () => {
        const mws = window.mainWindowService;
        return {
          mwsExists: !!mws,
          mwsType: typeof mws,
          hasCall: typeof mws?.call === 'function',
          hasMainWindow: !!mws?.mainWindow,
          mainWindowKeys: mws?.mainWindow ? Object.keys(mws.mainWindow).slice(0, 30) : [],
        };
      })()`);

      recordFinding("baseline", "mainWindowService availability", result);
      expect(result.ok).toBe(true);
    }, 30_000);

    it("reads current runner/execution state", async () => {
      const result = await getRunnerState(instance);
      recordFinding("baseline", "runner state", result);
      expect(result.ok).toBe(true);
    }, 30_000);

    it("checks if mainWindowService.call exposes collection methods", async () => {
      // Probe whether these method names are recognized
      const methods = ["canCollect", "prepareCollecting", "collect"];
      const results: Record<string, unknown> = {};

      for (const method of methods) {
        // Try calling with no args to see the error message — this tells us
        // if the method is recognized vs completely unknown
        const result = await probeIpcMethod(instance, method);
        results[method] = result;
      }

      recordFinding("baseline", "collection method availability", results);
    }, 30_000);
  });

  // -------------------------------------------------------------------
  // 2. canCollect
  // -------------------------------------------------------------------

  describe("2. canCollect", () => {
    it("tests canCollect('SearchPage')", async () => {
      const result = await probeIpcMethod(instance, "canCollect", "SearchPage");
      recordFinding("canCollect", "SearchPage", result);
    }, 30_000);

    it("tests canCollect with multiple source types", async () => {
      const sourceTypes = [
        "SearchPage",
        "MyConnections",
        "Alumni",
        "OrganizationPeople",
        "Group",
        "Event",
        "LWVYPP",
        "SentInvitationPage",
        "FollowersPage",
        "FollowingPage",
        "SNSearchPage",
        "SNListPage",
      ];

      const results: Record<string, unknown> = {};
      for (const sourceType of sourceTypes) {
        results[sourceType] = await probeIpcMethod(instance, "canCollect", sourceType);
      }

      recordFinding("canCollect", "all source types", results);
    }, 60_000);

    it("tests canCollect with invalid source type", async () => {
      const result = await probeIpcMethod(instance, "canCollect", "InvalidType");
      recordFinding("canCollect", "invalid source type", result);
    }, 30_000);
  });

  // -------------------------------------------------------------------
  // 3. prepareCollecting + collect
  // -------------------------------------------------------------------

  describe("3. prepareCollecting + collect flow", () => {
    it("tests prepareCollecting with { type: 'SearchPage', actionType: 'AutoCollectPeople' }", async () => {
      const result = await probeIpcMethod(instance, "prepareCollecting", {
        type: "SearchPage",
        actionType: "AutoCollectPeople",
      });
      recordFinding("prepareCollecting", "SearchPage + AutoCollectPeople (no URL)", result);
    }, 30_000);

    it("tests prepareCollecting with searchUrl included", async () => {
      const result = await probeIpcMethod(instance, "prepareCollecting", {
        type: "SearchPage",
        actionType: "AutoCollectPeople",
        searchUrl: TEST_SEARCH_URL,
      });
      recordFinding("prepareCollecting", "SearchPage + AutoCollectPeople + searchUrl", result);

      // Check state after prepareCollecting
      const stateAfter = await getRunnerState(instance);
      recordFinding("prepareCollecting", "runner state after prepareCollecting", stateAfter);
    }, 30_000);

    it("tests collect after prepareCollecting", async () => {
      // First, check if we're in preparing-collecting or collecting state
      const stateBefore = await getRunnerState(instance);
      recordFinding("collect", "state before collect", stateBefore);

      // Try collect with minimal params
      const result = await probeIpcMethod(instance, "collect", {
        limit: 5,
      });
      recordFinding("collect", "collect({ limit: 5 })", result);

      // Also try with more params as documented in research
      const result2 = await probeIpcMethod(instance, "collect", {
        limit: 5,
        maxPages: 1,
        pageSize: 5,
      });
      recordFinding("collect", "collect({ limit: 5, maxPages: 1, pageSize: 5 })", result2);

      // Check state after collect
      const stateAfter = await getRunnerState(instance);
      recordFinding("collect", "state after collect", stateAfter);
    }, 60_000);

    it("cancels collection and returns to idle", async () => {
      await cancelExecution(instance);

      // Give a moment for state machine to settle
      await new Promise((resolve) => setTimeout(resolve, 2_000));

      const stateAfter = await getRunnerState(instance);
      recordFinding("collect", "state after cancel", stateAfter);
    }, 30_000);
  });

  // -------------------------------------------------------------------
  // 4. executeSingleAction('AutoCollectPeople')
  // -------------------------------------------------------------------

  describe("4. executeSingleAction('AutoCollectPeople')", () => {
    it("tests executeSingleAction with empty config", async () => {
      const result = await probeIpcMethod(
        instance,
        "executeSingleAction",
        "AutoCollectPeople",
        {},
      );
      recordFinding("executeSingleAction", "AutoCollectPeople + empty config", result);

      // Cancel if it started
      await cancelExecution(instance);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }, 30_000);

    it("tests executeSingleAction with searchUrl in config", async () => {
      const result = await probeIpcMethod(
        instance,
        "executeSingleAction",
        "AutoCollectPeople",
        {
          searchUrl: TEST_SEARCH_URL,
          pageSize: 5,
          maxPages: 1,
        },
      );
      recordFinding(
        "executeSingleAction",
        "AutoCollectPeople + searchUrl + limits",
        result,
      );

      // Check state
      const stateAfter = await getRunnerState(instance);
      recordFinding(
        "executeSingleAction",
        "state after executeSingleAction AutoCollectPeople",
        stateAfter,
      );

      // Cancel
      await cancelExecution(instance);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }, 30_000);
  });

  // -------------------------------------------------------------------
  // 5. Alternative parameter shapes
  // -------------------------------------------------------------------

  describe("5. alternative parameter exploration", () => {
    it("probes prepareCollecting with actionType only", async () => {
      const result = await probeIpcMethod(instance, "prepareCollecting", {
        actionType: "AutoCollectPeople",
      });
      recordFinding("alternatives", "prepareCollecting({ actionType only })", result);
      await cancelExecution(instance);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }, 30_000);

    it("probes collect with no params", async () => {
      const result = await probeIpcMethod(instance, "collect");
      recordFinding("alternatives", "collect(no params)", result);
    }, 30_000);

    it("probes collect with just limit as number", async () => {
      const result = await probeIpcMethod(instance, "collect", 5);
      recordFinding("alternatives", "collect(5)", result);
    }, 30_000);

    it("reads available IPC method names from mainWindowService", async () => {
      const result = await probeExpression(instance, `(async () => {
        const mws = window.mainWindowService;
        if (!mws) return { error: 'no mainWindowService' };

        // Try to enumerate methods
        const methods = [];
        try {
          const proto = Object.getPrototypeOf(mws);
          if (proto) {
            methods.push(...Object.getOwnPropertyNames(proto).filter(
              k => typeof proto[k] === 'function' && k !== 'constructor'
            ));
          }
        } catch {}

        // Also check own properties
        const ownMethods = Object.keys(mws).filter(k => typeof mws[k] === 'function');

        // Check for _methods or _handlers map
        let registeredMethods = null;
        try {
          if (mws._methods) registeredMethods = Object.keys(mws._methods);
          else if (mws._handlers) registeredMethods = Object.keys(mws._handlers);
          else if (mws.methods) registeredMethods = Object.keys(mws.methods);
        } catch {}

        return {
          protoMethods: methods.slice(0, 50),
          ownMethods: ownMethods.slice(0, 50),
          registeredMethods: registeredMethods?.slice(0, 50) || null,
        };
      })()`);

      recordFinding("alternatives", "mainWindowService method enumeration", result);
    }, 30_000);
  });

  // -------------------------------------------------------------------
  // 6. State machine observation
  // -------------------------------------------------------------------

  describe("6. state machine observation", () => {
    it("reads execution state via all known paths", async () => {
      const result = await probeExpression(instance, `(async () => {
        const mws = window.mainWindowService;
        if (!mws) return { error: 'no mainWindowService' };

        const paths = {};

        // Path 1: direct state property
        try { paths['mws.state'] = mws.state; } catch (e) { paths['mws.state'] = 'error: ' + e.message; }
        try { paths['mws.executionState'] = mws.executionState; } catch (e) { paths['mws.executionState'] = 'error: ' + e.message; }

        // Path 2: mainWindow state
        const mw = mws.mainWindow;
        if (mw) {
          try { paths['mw.state'] = mw.state; } catch (e) { paths['mw.state'] = 'error: ' + e.message; }
          try { paths['mw.executionState'] = mw.executionState; } catch (e) { paths['mw.executionState'] = 'error: ' + e.message; }
          try { paths['mw.runnerState'] = mw.runnerState; } catch (e) { paths['mw.runnerState'] = 'error: ' + e.message; }

          // Path 3: contentWindowController state
          const cwc = mw.contentWindowController;
          if (cwc) {
            try { paths['cwc.state'] = cwc.state; } catch (e) { paths['cwc.state'] = 'error: ' + e.message; }
            try { paths['cwc.executionState'] = cwc.executionState; } catch (e) { paths['cwc.executionState'] = 'error: ' + e.message; }
          }
        }

        // Path 4: Redux store
        try {
          const store = window.__REDUX_STORE__ || window.__store__;
          if (store) {
            const s = store.getState();
            const topKeys = Object.keys(s || {});
            paths['redux.topKeys'] = topKeys;
            // Look for execution-related keys
            for (const key of topKeys) {
              if (key.match(/exec|runner|state|campaign/i)) {
                try {
                  const val = s[key];
                  paths['redux.' + key] = typeof val === 'object' ? JSON.parse(JSON.stringify(val)) : val;
                } catch {}
              }
            }
          }
        } catch {}

        return paths;
      })()`);

      recordFinding("state-machine", "all execution state paths", result);
    }, 30_000);
  });
});
