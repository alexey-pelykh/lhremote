import type { Profile } from "../types/index.js";
import type { DatabaseClient } from "../db/index.js";
import { ProfileNotFoundError, ProfileRepository } from "../db/index.js";
import type { InstanceService } from "./instance.js";
import { ExtractionTimeoutError } from "./errors.js";

/** Default interval between database polls (ms). */
const DEFAULT_POLL_INTERVAL = 1000;

/** Default maximum time to wait for extraction (ms). */
const DEFAULT_POLL_TIMEOUT = 30_000;

/** Delay after triggering extraction before first poll (ms). */
const EXTRACTION_SETTLE_DELAY = 2000;

export interface VisitAndExtractOptions {
  /** Interval between database polls in ms (default 1000). */
  pollInterval?: number;
  /** Maximum time to wait for extraction in ms (default 30000). */
  pollTimeout?: number;
}

/**
 * Orchestrates the visit-and-extract workflow.
 *
 * Navigates an instance to a LinkedIn profile, triggers extraction,
 * then polls the database until the profile data appears.
 */
export class ProfileService {
  private readonly instance: InstanceService;
  private readonly profileRepo: ProfileRepository;

  constructor(instance: InstanceService, db: DatabaseClient) {
    this.instance = instance;
    this.profileRepo = new ProfileRepository(db);
  }

  /**
   * Visit a LinkedIn profile and extract its data.
   *
   * 1. Navigate the instance to the profile URL
   * 2. Wait for the page to settle
   * 3. Trigger SaveCurrentProfile extraction
   * 4. Poll the database until profile data appears
   *
   * @param profileUrl - Full LinkedIn profile URL (e.g. `https://www.linkedin.com/in/slug`)
   * @returns The extracted profile data.
   * @throws {ExtractionTimeoutError} if the data does not appear within the timeout.
   */
  async visitAndExtract(
    profileUrl: string,
    options?: VisitAndExtractOptions,
  ): Promise<Profile> {
    const slug = extractSlug(profileUrl);
    const pollInterval = options?.pollInterval ?? DEFAULT_POLL_INTERVAL;
    const pollTimeout = options?.pollTimeout ?? DEFAULT_POLL_TIMEOUT;

    await this.instance.navigateToProfile(profileUrl);
    await delay(EXTRACTION_SETTLE_DELAY);
    await this.instance.triggerExtraction();

    return this.pollForProfile(slug, pollInterval, pollTimeout, profileUrl);
  }

  private async pollForProfile(
    slug: string,
    interval: number,
    timeout: number,
    profileUrl: string,
  ): Promise<Profile> {
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      try {
        return this.profileRepo.findByPublicId(slug);
      } catch (error) {
        if (!(error instanceof ProfileNotFoundError)) {
          throw error;
        }
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await delay(Math.min(interval, remaining));
    }

    throw new ExtractionTimeoutError(profileUrl, timeout);
  }
}

/**
 * Extract the public ID slug from a LinkedIn profile URL.
 *
 * Handles URLs like:
 * - `https://www.linkedin.com/in/john-doe`
 * - `https://www.linkedin.com/in/john-doe/`
 * - `https://linkedin.com/in/john-doe?param=1`
 */
export function extractSlug(profileUrl: string): string {
  const url = new URL(profileUrl);
  const segments = url.pathname.split("/").filter(Boolean);
  const inIndex = segments.indexOf("in");
  const slug = inIndex !== -1 ? segments[inIndex + 1] : undefined;
  if (!slug) {
    throw new Error(
      `Invalid LinkedIn profile URL: ${profileUrl} (expected /in/{slug})`,
    );
  }
  return decodeURIComponent(slug);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
