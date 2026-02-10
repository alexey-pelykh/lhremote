import type {
  ActionPeopleCounts,
  Campaign,
  CampaignConfig,
  CampaignRunResult,
  CampaignStatus,
  CampaignSummary,
  RunnerState,
} from "../types/index.js";
import type { DatabaseClient } from "../db/index.js";
import { CampaignRepository } from "../db/index.js";
import { delay } from "../utils/delay.js";
import { errorMessage } from "../utils/error-message.js";
import type { InstanceService } from "./instance.js";
import { CampaignExecutionError, CampaignTimeoutError } from "./errors.js";

/** Maximum time to wait for the campaign runner to reach idle (ms). */
const IDLE_WAIT_TIMEOUT = 60_000;

/** Interval between idle state polls (ms). */
const IDLE_POLL_INTERVAL = 1_000;

/** LinkedHelper people processing states for action count queries. */
const PEOPLE_STATE = {
  QUEUED: 1,
  PROCESSED: 2,
  SUCCESSFUL: 3,
  FAILED: 4,
} as const;

/**
 * Manages campaign lifecycle and execution via CDP + database.
 *
 * - CRUD operations combine CDP calls (create, delete) with database
 *   reads (list, get).
 * - Execution operations (start, stop, status, results) control the
 *   LinkedHelper campaign runner through CDP and read results from
 *   the database.
 */
export class CampaignService {
  private readonly instance: InstanceService;
  private readonly campaignRepo: CampaignRepository;

  constructor(instance: InstanceService, db: DatabaseClient) {
    this.instance = instance;
    this.campaignRepo = new CampaignRepository(db);
  }

  /**
   * Create a new campaign via the LinkedHelper UI API.
   *
   * Calls `source.people.campaigns.createCampaign()` via CDP,
   * then reads the campaign back from the database.
   */
  async create(config: CampaignConfig): Promise<Campaign> {
    const liAccountId = config.liAccountId ?? 1;

    const actions = config.actions.map((a) => ({
      name: a.name,
      description: a.description ?? "",
      target: [],
      config: {
        actionType: a.actionType,
        coolDown: a.coolDown ?? 60_000,
        maxActionResultsPerIteration: a.maxActionResultsPerIteration ?? 10,
        actionSettings: a.actionSettings ?? {},
      },
    }));

    try {
      const result = await this.instance.evaluateUI<{ id: number }>(
        `(async function() {
          const pc = window.mainWindowService.mainWindow.source.people.campaigns;
          const r = await pc.createCampaign(${JSON.stringify({
            name: config.name,
            liAccount: liAccountId,
            excludeList: [],
            actions,
          })});
          return { id: r.id };
        })()`,
      );

      return this.campaignRepo.getCampaign(result.id);
    } catch (error) {
      if (error instanceof CampaignExecutionError) throw error;
      const message = errorMessage(error);
      throw new CampaignExecutionError(
        `Failed to create campaign: ${message}`,
        undefined,
        { cause: error },
      );
    }
  }

  /**
   * List all non-archived campaigns.
   */
  list(): CampaignSummary[] {
    return this.campaignRepo.listCampaigns();
  }

  /**
   * Get a campaign by ID.
   *
   * @throws {CampaignNotFoundError} if the campaign does not exist.
   */
  get(campaignId: number): Campaign {
    return this.campaignRepo.getCampaign(campaignId);
  }

  /**
   * Delete (archive) a campaign.
   *
   * LinkedHelper does not support hard deletes — this archives
   * the campaign, removing it from the active list.
   *
   * @throws {CampaignNotFoundError} if the campaign does not exist.
   */
  async delete(campaignId: number): Promise<void> {
    const campaign = this.campaignRepo.getCampaign(campaignId);

    try {
      await this.instance.evaluateUI(
        `(async function() {
          const src = window.mainWindowService.mainWindow.source.campaigns;
          await src.setCampaignArchivedStatus(${String(campaign.id)}, true);
        })()`,
      );
    } catch (error) {
      if (error instanceof CampaignExecutionError) throw error;
      const message = errorMessage(error);
      throw new CampaignExecutionError(
        `Failed to delete campaign ${String(campaignId)}: ${message}`,
        campaignId,
        { cause: error },
      );
    }
  }

  /**
   * Start campaign execution for the specified persons.
   *
   * Performs the full start sequence:
   * 1. Reset specified persons for re-run (three-table reset)
   * 2. Wait for the campaign runner to reach idle state
   * 3. Unpause the campaign
   * 4. Start the campaign runner
   *
   * @throws {CampaignNotFoundError} if the campaign does not exist.
   * @throws {CampaignTimeoutError} if the runner does not reach idle.
   * @throws {CampaignExecutionError} if the runner fails to start.
   */
  async start(campaignId: number, personIds: number[]): Promise<void> {
    const campaign = this.campaignRepo.getCampaign(campaignId);

    // Step 1: Reset persons for re-run
    if (personIds.length > 0) {
      this.campaignRepo.resetForRerun(campaignId, personIds);
    }

    // Step 2: Wait for idle
    await this.waitForIdle(campaignId);

    // Step 3: Unpause
    try {
      await this.instance.evaluateUI(
        `(async function() {
          const src = window.mainWindowService.mainWindow.source.campaigns;
          await src.setCampaignPaused(${String(campaign.id)}, false, ${String(campaign.liAccountId)});
        })()`,
      );
    } catch (error) {
      const message = errorMessage(error);
      throw new CampaignExecutionError(
        `Failed to unpause campaign ${String(campaignId)}: ${message}`,
        campaignId,
        { cause: error },
      );
    }

    // Step 4: Start runner
    try {
      const started = await this.instance.evaluateUI<boolean>(
        `(function() {
          return window.mainWindowService.mainWindow.campaignController.start();
        })()`,
        false,
      );

      if (!started) {
        throw new CampaignExecutionError(
          `Campaign runner failed to start (not in idle state)`,
          campaignId,
        );
      }
    } catch (error) {
      if (error instanceof CampaignExecutionError) throw error;
      const message = errorMessage(error);
      throw new CampaignExecutionError(
        `Failed to start campaign runner: ${message}`,
        campaignId,
        { cause: error },
      );
    }
  }

  /**
   * Stop campaign execution.
   *
   * Pauses the specific campaign and stops the global runner.
   *
   * @throws {CampaignNotFoundError} if the campaign does not exist.
   */
  async stop(campaignId: number): Promise<void> {
    const campaign = this.campaignRepo.getCampaign(campaignId);

    try {
      // Pause the specific campaign
      await this.instance.evaluateUI(
        `(async function() {
          const src = window.mainWindowService.mainWindow.source.campaigns;
          await src.setCampaignPaused(${String(campaign.id)}, true, ${String(campaign.liAccountId)});
        })()`,
      );

      // Stop the global runner
      await this.instance.evaluateUI(
        `(function() {
          window.mainWindowService.mainWindow.campaignController.stop();
        })()`,
        false,
      );
    } catch (error) {
      if (error instanceof CampaignExecutionError) throw error;
      const message = errorMessage(error);
      throw new CampaignExecutionError(
        `Failed to stop campaign ${String(campaignId)}: ${message}`,
        campaignId,
        { cause: error },
      );
    }
  }

  /**
   * Get real-time campaign execution status.
   *
   * Combines the database campaign state with live CDP data
   * (runner state and per-action people counts).
   *
   * @throws {CampaignNotFoundError} if the campaign does not exist.
   */
  async getStatus(campaignId: number): Promise<CampaignStatus> {
    const campaign = this.campaignRepo.getCampaign(campaignId);
    const actions = this.campaignRepo.getCampaignActions(campaignId);
    const actionIds = actions.map((a) => a.id);

    const [runnerState, isPaused, actionCounts] = await Promise.all([
      this.getRunnerState(),
      this.getIsPaused(campaignId),
      this.getActionPeopleCounts(actionIds),
    ]);

    return {
      campaignState: campaign.state,
      isPaused,
      runnerState,
      actionCounts,
    };
  }

  /**
   * Get campaign execution results.
   *
   * Returns database results combined with live per-action people counts.
   *
   * @throws {CampaignNotFoundError} if the campaign does not exist.
   */
  async getResults(campaignId: number): Promise<CampaignRunResult> {
    const results = this.campaignRepo.getResults(campaignId);
    const actions = this.campaignRepo.getCampaignActions(campaignId);
    const actionIds = actions.map((a) => a.id);
    const actionCounts = await this.getActionPeopleCounts(actionIds);

    return {
      campaignId,
      results,
      actionCounts,
    };
  }

  /**
   * Wait for the campaign runner to reach idle state.
   */
  private async waitForIdle(campaignId: number): Promise<void> {
    const deadline = Date.now() + IDLE_WAIT_TIMEOUT;

    while (Date.now() < deadline) {
      const state = await this.getRunnerState();
      if (state === "idle") return;

      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await delay(Math.min(IDLE_POLL_INTERVAL, remaining));
    }

    throw new CampaignTimeoutError(
      `Campaign runner did not reach idle state within ${String(IDLE_WAIT_TIMEOUT)}ms`,
      campaignId,
    );
  }

  /**
   * Get the current runner state from CDP.
   */
  private async getRunnerState(): Promise<RunnerState> {
    return this.instance.evaluateUI<RunnerState>(
      `window.mainWindowService.mainWindow.state`,
      false,
    );
  }

  /**
   * Check if a campaign is paused via CDP.
   */
  private async getIsPaused(campaignId: number): Promise<boolean> {
    return this.instance.evaluateUI<boolean>(
      `(async function() {
        const src = window.mainWindowService.mainWindow.source.campaigns;
        return await src.isCampaignPaused(${String(campaignId)});
      })()`,
    );
  }

  /**
   * Get people counts for each action via CDP.
   */
  private async getActionPeopleCounts(
    actionIds: number[],
  ): Promise<ActionPeopleCounts[]> {
    return Promise.all(
      actionIds.map(async (actionId) => {
        const [queued, processed, successful, failed] = await Promise.all([
          this.instance.evaluateUI<number>(
            `(async () => window.mainWindowService.mainWindow.source.people.actions.getActionPeopleCount(${String(actionId)}, ${String(PEOPLE_STATE.QUEUED)}))()`,
          ),
          this.instance.evaluateUI<number>(
            `(async () => window.mainWindowService.mainWindow.source.people.actions.getActionPeopleCount(${String(actionId)}, ${String(PEOPLE_STATE.PROCESSED)}))()`,
          ),
          this.instance.evaluateUI<number>(
            `(async () => window.mainWindowService.mainWindow.source.people.actions.getActionPeopleCount(${String(actionId)}, ${String(PEOPLE_STATE.SUCCESSFUL)}))()`,
          ),
          this.instance.evaluateUI<number>(
            `(async () => window.mainWindowService.mainWindow.source.people.actions.getActionPeopleCount(${String(actionId)}, ${String(PEOPLE_STATE.FAILED)}))()`,
          ),
        ]);

        return { actionId, queued, processed, successful, failed };
      }),
    );
  }
}
