// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import type { SourceType } from "../types/index.js";
import type { RunnerState } from "../types/index.js";
import { delay } from "../utils/delay.js";
import { errorMessage } from "../utils/error-message.js";
import { detectSourceType, toInternalSourceType } from "./source-type-registry.js";
import type { InstanceService } from "./instance.js";
import { CollectionBusyError, CollectionError } from "./errors.js";

/** Timeout for polling `canCollect` after navigation (ms). */
const CAN_COLLECT_TIMEOUT = 10_000;

/** Interval between `canCollect` polls (ms). */
const CAN_COLLECT_POLL_INTERVAL = 500;

/**
 * Manages people collection from LinkedIn pages via CDP.
 *
 * Collection uses the dedicated `prepareCollecting` → `collect` IPC
 * entry point, which drives the LinkedHelper state machine through
 * `idle → preparing-collecting → collecting → idle`.
 *
 * The {@link collect} method returns immediately — callers should poll
 * the runner state (`mainWindow.state`) for progress.
 */
export class CollectionService {
  private readonly instance: InstanceService;

  constructor(instance: InstanceService) {
    this.instance = instance;
  }

  /**
   * Initiate people collection from a LinkedIn source URL.
   *
   * Validates that the source URL is a recognized LinkedIn page type,
   * ensures the instance is idle, navigates to the URL, verifies the
   * page is recognized, then drives the LinkedHelper state machine
   * through its Redux saga to start collection.
   *
   * Returns immediately after initiating collection — the actual
   * collection runs asynchronously in LinkedHelper. Poll the runner
   * state via {@link getRunnerState} for progress.
   *
   * @param sourceUrl - LinkedIn page URL to collect from (e.g., search results URL).
   * @param campaignId - Campaign to associate the collection with.
   * @param options - Collection parameters (limit, maxPages, pageSize).
   * @throws {CollectionError} if the source URL is not recognized, canCollect returns false,
   *   or the CDP calls fail.
   * @throws {CollectionBusyError} if the instance is not idle.
   */
  async collect(
    sourceUrl: string,
    campaignId: number,
    actionId: number,
  ): Promise<void> {
    const sourceType = detectSourceType(sourceUrl);
    if (!sourceType) {
      throw new CollectionError(
        `Unrecognized source URL: ${sourceUrl} — cannot determine LinkedIn page type`,
      );
    }

    await this.ensureIdle();

    try {
      await this.instance.navigateLinkedIn(sourceUrl);
    } catch (error) {
      if (error instanceof CollectionError) throw error;
      const message = errorMessage(error);
      throw new CollectionError(
        `Failed to navigate to source URL: ${message}`,
        { cause: error },
      );
    }

    await this.assertCanCollect(sourceType);

    try {
      await this.startCollecting(sourceType, campaignId, actionId);
    } catch (error) {
      if (error instanceof CollectionError) throw error;
      const message = errorMessage(error);
      throw new CollectionError(
        `Failed to start collection: ${message}`,
        { cause: error },
      );
    }
  }

  /**
   * Check whether collection is possible for a given source type.
   *
   * This is a page-state check — returns `true` only when the
   * LinkedHelper browser is currently on a matching source page.
   */
  async canCollect(sourceType: SourceType): Promise<boolean> {
    const internalType = toInternalSourceType(sourceType);
    return this.instance.evaluateUI<boolean>(
      `(async () => {
        const mws = window.mainWindowService;
        return await mws.call('canCollect', ${JSON.stringify(internalType)});
      })()`,
    );
  }

  /**
   * Get the current runner state from the LinkedHelper main window.
   */
  async getRunnerState(): Promise<RunnerState> {
    return this.instance.evaluateUI<RunnerState>(
      `window.mainWindowService.mainWindow.state`,
      false,
    );
  }

  /**
   * Ensure the instance runner is idle.
   *
   * @throws {CollectionBusyError} if the runner is not idle.
   */
  private async ensureIdle(): Promise<void> {
    const state = await this.getRunnerState();
    if (state !== "idle") {
      throw new CollectionBusyError(state);
    }
  }

  /**
   * Poll `canCollect` until it returns `true` or the timeout is reached.
   *
   * LinkedHelper's page detection is asynchronous — it needs time after the
   * browser `load` event to recognize the page type through its state machine.
   *
   * @throws {CollectionError} if `canCollect` does not return `true` within the timeout.
   */
  private async assertCanCollect(sourceType: SourceType): Promise<void> {
    const start = Date.now();
    const deadline = start + CAN_COLLECT_TIMEOUT;

    while (Date.now() < deadline) {
      const result = await this.canCollect(sourceType);
      if (result) {
        return;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        break;
      }
      await delay(Math.min(CAN_COLLECT_POLL_INTERVAL, remaining));
    }

    const elapsed = Date.now() - start;
    throw new CollectionError(
      `Cannot collect from ${sourceType} — the LinkedIn browser is not on a matching page (polled for ${String(elapsed)}ms)`,
    );
  }

  /**
   * Call `collect` on the main process with the correct two-argument
   * signature discovered from LinkedHelper's renderer source:
   *
   * ```
   * mainWindowService.call("collect", sourceType, {
   *   campaignId, actionId, target, withoutScraping
   * })
   * ```
   *
   * The main process `collect` method expects the source type as the
   * first argument and a config object as the second. The config must
   * include `actionId` (the campaign action to collect into) and
   * `target` (the collection target type).
   *
   * @throws {CollectionError} if the call returns `false`.
   */
  private async startCollecting(
    sourceType: SourceType,
    campaignId: number,
    actionId: number,
  ): Promise<void> {
    const internalType = toInternalSourceType(sourceType);
    const config: Record<string, unknown> = {
      campaignId,
      actionId,
      target: "target",
    };

    // Fire-and-forget: the collect IPC method blocks until collection
    // finishes (which can take minutes). We start it without awaiting
    // the result — callers poll getRunnerState() for progress.
    await this.instance.evaluateUI<boolean>(
      `(() => {
        const mws = window.mainWindowService;
        mws.call('collect', ${JSON.stringify(internalType)}, ${JSON.stringify(config)});
        return true;
      })()`,
      false,
    );
  }
}
